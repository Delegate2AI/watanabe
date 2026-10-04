"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "@/components/identity-provider";
import type { AccessChange, AccessHistoryEntry, AccessState } from "@/lib/authority/access";
import type { Person } from "@/lib/people/types";
import { AccessFlags, type FlagRuntimeState } from "./access-flags";
import { AccessGroups } from "./access-groups";
import { AccessHistory } from "./access-history";
import { AccessMembers } from "./access-members";
import { AccessTabs, type Tab } from "./access-tabs";
import { McpTokensPanel } from "./mcp-tokens-panel";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";

export function AccessAdmin({
  access,
  history,
  groupsEnabled,
  rolesEnabled,
  flagStates,
  people = {},
  candidates = [],
  aliases = {},
  peopleEnabled = false,
  aliasesEnabled = false,
  mcpTokensEnabled = false,
  mcpTokens = [],
  viewerIsBootstrapAdmin = false,
}: {
  access: AccessState;
  history: AccessHistoryEntry[];
  groupsEnabled: boolean;
  rolesEnabled: boolean;
  flagStates: Record<string, FlagRuntimeState>;
  /** Resolved on the server: a client component cannot read the directory. */
  people?: Record<string, Person>;
  candidates?: readonly Person[];
  /**
   * canonical email -> the other addresses that resolve to it. Read on the
   * server, like the directory. The whole map is safe to ship here because the
   * page itself is already gated on `manageAccess`.
   */
  aliases?: Record<string, string[]>;
  peopleEnabled?: boolean;
  aliasesEnabled?: boolean;
  mcpTokensEnabled?: boolean;
  /** The viewer's own tokens, read on the server. Never carries a secret. */
  mcpTokens?: { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
  /**
   * Whether the viewer's admin role comes from `BOOTSTRAP_ADMINS` rather than
   * the roles store. Resolved on the server. Without it this bar announced a
   * role that appears nowhere in the member list right beside it, which reads
   * as one of the two being wrong when both are correct.
   */
  viewerIsBootstrapAdmin?: boolean;
}) {
  const identity = useIdentity();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  // Local, optimistic overrides of the server-rendered flag state. mutate()
  // now calls router.refresh() on success, but the access commit (git
  // fetch/rebase/push) is not instant, so without this the switch would sit at
  // its pre-click position until the refresh lands. The override flips it
  // immediately; the refresh then re-reads the committed value, which agrees.
  const [flagOverrides, setFlagOverrides] = useState<Record<string, boolean>>({});
  const roster = useMemo(() => [...new Set([
    ...Object.values(access.groups).flat(),
    ...Object.values(access.roles).flat(),
  ])].sort(), [access]);
  const overrides = useMemo(
    () => ({ ...access.flags, ...flagOverrides }),
    [access.flags, flagOverrides],
  );

  async function mutate(change: AccessChange): Promise<boolean> {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      });
      const result = await response.json() as { error?: unknown; warnings?: string[] };
      if (!response.ok) {
        const failure = messageForBody(result);
        setMessage(failure);
        notifyFailure(failure);
        return false;
      }
      const success = result.warnings?.[0] ?? "Access updated.";
      // The `role="status"` banner sits at the top of the panel, so a change
      // made far down the members list committed with no feedback in view. A
      // toast confirms it regardless of scroll position; the banner stays for
      // the live region and any warning detail.
      setMessage(success);
      notifySuccess(success);
      // Re-run the force-dynamic page's server render so the committed state
      // (new group, member, role, or flag) shows without a manual reload.
      // commitPrivateAccess writes into the same dir loadAccess() reads, so the
      // refreshed render sees the change.
      router.refresh();
      return true;
    } catch {
      const failure = "Access change could not be submitted.";
      setMessage(failure);
      notifyFailure(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  // A small, reusable pairing for messages that never reach the mutate() flow,
  // for example a client-side guard that returns before any fetch. Mirrors the
  // failure pairing mutate() itself uses: the status banner sits at the top of
  // the panel, so a message raised from a group card far down the page needs
  // the toast too, or it can land entirely off screen.
  function notice(text: string): void {
    setMessage(text);
    notifyFailure(text);
  }

  async function toggleFlag(envVar: string, nextValue: boolean): Promise<void> {
    const ok = await mutate({ verb: "setFlag", name: envVar, value: nextValue });
    if (ok) setFlagOverrides((current) => ({ ...current, [envVar]: nextValue }));
  }

  // Name edits go to their own route, not /api/access: a display name is
  // presentation data on a separate file, and it must not ride the same commit
  // as clearance or role changes.
  async function renamePerson(email: string, name: string): Promise<boolean> {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/people", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const result = await response.json() as { error?: unknown };
      if (!response.ok) {
        const failure = messageForBody(result);
        setMessage(failure);
        notifyFailure(failure);
        return false;
      }
      setMessage("Name updated.");
      notifySuccess("Name updated.");
      router.refresh();
      return true;
    } catch {
      const failure = "Name change could not be submitted.";
      setMessage(failure);
      notifyFailure(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  // Alias edits go to their own route for the same reason name edits do: a
  // separate file and a separate commit. Unlike a name, an alias decides which
  // groups a session resolves to, so the failure is reported the same way a
  // refused access change is rather than being swallowed.
  async function mutateAlias(
    verb: "addAlias" | "removeAlias",
    email: string,
    alias: string,
  ): Promise<boolean> {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/aliases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verb, email, alias }),
      });
      const result = await response.json() as { error?: unknown };
      if (!response.ok) {
        const failure = messageForBody(result);
        setMessage(failure);
        notifyFailure(failure);
        return false;
      }
      const success = verb === "addAlias"
        ? `${alias} now resolves to ${email}.`
        : `${alias} no longer resolves to ${email}.`;
      setMessage(success);
      notifySuccess(success);
      router.refresh();
      return true;
    } catch {
      const failure = "Alias change could not be submitted.";
      setMessage(failure);
      notifyFailure(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <AccessTabs
        tab={tab}
        onTab={setTab}
        email={identity.email}
        role={identity.role}
        viewerIsBootstrapAdmin={viewerIsBootstrapAdmin}
      />

      {!groupsEnabled && !rolesEnabled && tab !== "flags" && (
        <div className="rounded-xl bg-surface p-6 text-sm text-ink-muted shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          Group and role editing is disabled. Set AUTHORITY_ENABLED or ROLES_ENABLED to enable the relevant controls.
        </div>
      )}
      {message && <p role="status" className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink">{message}</p>}

      {tab === "members" && (
        <AccessMembers
          access={access}
          people={people}
          roster={roster}
          candidates={candidates}
          aliases={aliases}
          peopleEnabled={peopleEnabled}
          groupsEnabled={groupsEnabled}
          rolesEnabled={rolesEnabled}
          aliasesEnabled={aliasesEnabled}
          pending={pending}
          mutate={mutate}
          renamePerson={renamePerson}
          mutateAlias={mutateAlias}
          onNotice={notice}
        />
      )}

      {tab === "groups" && (
        <AccessGroups
          access={access}
          people={people}
          candidates={candidates}
          groupsEnabled={groupsEnabled}
          pending={pending}
          mutate={mutate}
          onNotice={notice}
        />
      )}

      {tab === "flags" && (
        <AccessFlags
          flagStates={flagStates}
          overrides={overrides}
          pending={pending}
          onToggle={(envVar, next) => void toggleFlag(envVar, next)}
        />
      )}

      {tab === "tokens" && <McpTokensPanel enabled={mcpTokensEnabled} initialTokens={mcpTokens} />}

      {tab === "history" && <AccessHistory history={history} people={people} />}
    </div>
  );
}
