"use client";

import { useMemo, useState } from "react";
import { ExternalLinks } from "./external-links";
import {
  ShareRecipientLabel,
  ShareRecipientSelect,
  parseRecipientKey,
  teamLabel,
} from "./share-recipient";
import type { Person } from "@/lib/people/types";
import type { DocShare, DocLink, ShareOptions, SharedAccess } from "@/lib/shared-docs/types";

/**
 * The owner-only share manager (spec 28, team sharing 2026-08-11). Adds/updates
 * and revokes shares, and (when external sharing is enabled) mints/revokes
 * signed external links (view|comment only). The server renders this ONLY for
 * the owner; the routes it calls independently re-check owner authorization.
 *
 * A recipient is a PERSON or a TEAM, both picked from a server-resolved list
 * (`shareOptionsFor`). A team grant tracks that team's membership, so the row
 * says "engineering", not the six people who were in it that afternoon.
 */
export function ShareManager({
  id,
  initialShares,
  initialLinks,
  externalEnabled,
  options = { teams: [], people: [] },
  people = {},
}: {
  id: string;
  initialShares: DocShare[];
  initialLinks: DocLink[];
  externalEnabled: boolean;
  /** Teams and people this owner may share with, resolved server-side. */
  options?: ShareOptions;
  people?: Record<string, Person>;
}) {
  const [shares, setShares] = useState(initialShares);
  const [target, setTarget] = useState("");
  const [access, setAccess] = useState<SharedAccess>("view");
  const [busy, setBusy] = useState(false);
  // Which recipient's Revoke is awaiting confirmation, as its option key so a
  // person and a team of the same name can never share one confirmation slot.
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const teamCounts = useMemo(
    () => Object.fromEntries(options.teams.map((t) => [t.name, t.memberCount])),
    [options.teams],
  );

  async function refreshShares() {
    const res = await fetch(`/api/docs/${id}/shares`);
    if (res.ok) setShares(((await res.json()) as { shares: DocShare[] }).shares);
  }

  async function addShare() {
    const parsed = parseRecipientKey(target);
    if (!parsed) return;
    setBusy(true);
    try {
      await fetch(`/api/docs/${id}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipient: parsed.recipient, kind: parsed.kind, access }),
      });
      setTarget("");
      await refreshShares();
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(share: DocShare, nextAccess: SharedAccess) {
    setBusy(true);
    try {
      // upsertShare on the server treats a repeat recipient as a role update.
      await fetch(`/api/docs/${id}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: share.recipient,
          kind: share.recipientKind,
          access: nextAccess,
        }),
      });
      await refreshShares();
    } finally {
      setBusy(false);
    }
  }
  async function revokeShare(share: DocShare) {
    await fetch(`/api/docs/${id}/shares`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: share.recipient, kind: share.recipientKind }),
    });
    await refreshShares();
  }

  /** How a row names its recipient in an aria-label and confirmation copy. */
  function describe(share: DocShare): string {
    if (share.recipientKind !== "group") return share.recipient;
    return teamLabel(share.recipient, teamCounts[share.recipient] ?? null);
  }
  function rowKey(share: DocShare): string {
    return `${share.recipientKind}:${share.recipient}`;
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink">Sharing</h2>
        <div className="flex flex-wrap items-center gap-2">
          <ShareRecipientSelect
            id={id}
            options={options}
            value={target}
            disabled={busy}
            onChange={setTarget}
          />
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as SharedAccess)}
            aria-label="Access for new recipient"
            className="rounded-chip border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink"
          >
            <option value="view">Can view</option>
            <option value="comment">Can comment</option>
            <option value="edit">Can edit</option>
          </select>
          <button
            type="button"
            onClick={addShare}
            disabled={busy || target === ""}
            className="rounded-chip bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            Share
          </button>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {shares.length === 0 ? (
            <li className="text-sm text-ink-muted">Not shared with anyone yet.</li>
          ) : null}
          {shares.map((s) => (
            <li key={rowKey(s)} className="flex items-center justify-between gap-2 text-sm">
              <ShareRecipientLabel share={s} people={people} teamCounts={teamCounts} />
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={s.access}
                  disabled={busy}
                  onChange={(e) => changeRole(s, e.target.value as SharedAccess)}
                  aria-label={`Access for ${describe(s)}`}
                  className="rounded-chip border border-line bg-surface-2 px-2 py-1 text-xs text-ink disabled:opacity-60"
                >
                  <option value="view">Can view</option>
                  <option value="comment">Can comment</option>
                  <option value="edit">Can edit</option>
                </select>
                {confirmingRevoke === rowKey(s) ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingRevoke(null);
                        void revokeShare(s);
                      }}
                      className="text-xs font-medium text-warn hover:underline"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRevoke(null)}
                      className="text-xs text-ink-muted hover:text-ink"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingRevoke(rowKey(s))}
                    aria-label={`Revoke access for ${describe(s)}`}
                    className="text-xs text-ink-muted hover:text-warn"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {externalEnabled && <ExternalLinks id={id} initialLinks={initialLinks} />}
    </section>
  );
}
