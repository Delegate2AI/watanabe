"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import { SkillsInstallForm } from "./skills-install-form";
import { SkillCard } from "./skills-list";
import { FailureBanner, OutcomeBanner, outcomeHeadline } from "./skills-outcome";
import { setGroupsBody, uninstallBody, updateBody } from "./skills-payloads";
import type { InstallBody, SkillActionKind, SkillOutcome, SkillRow } from "./skills-types";

/**
 * The `/admin/skills` surface (spec 34).
 *
 * The list arrives already resolved from the server page, so nothing here
 * fetches it: mutations POST to `/api/admin/skills` (or to its `/upload` sibling
 * for a zip) and then `router.refresh()` re-runs the force-dynamic page, exactly
 * like `connectors-admin.tsx`. The marketplace indexes are the one thing that is
 * NOT resolved on the page, because a refresh after every mutation would re-run
 * their network fan-out; the install form loads those on demand.
 *
 * Every reply is reported through one banner rather than a toast alone. An
 * install that replaced an existing skill, an uninstall that left a directory
 * behind, and a skill carrying scripts the Bash policy can never run are all
 * successes at the HTTP level and all things an admin has to see.
 */

/** The loader reports a whole-file parse failure under this slug, not a skill. */
const FILE_ERROR_SLUG = "*";

type Failure = { text: string; reason?: string };

/** Keep only the fields the API documents, rather than spreading a whole body in. */
function toOutcome(body: unknown, kind: SkillActionKind, fallbackSlug: string): SkillOutcome {
  const reported = (body ?? {}) as Record<string, unknown>;
  const blocked = reported.blockedScripts;
  return {
    kind,
    slug: typeof reported.slug === "string" ? reported.slug : fallbackSlug,
    ...(reported.replaced === true ? { replaced: true } : {}),
    ...(typeof reported.commit === "string" ? { commit: reported.commit } : {}),
    ...(typeof reported.previousCommit === "string" ? { previousCommit: reported.previousCommit } : {}),
    ...(typeof reported.warning === "string" ? { warning: reported.warning } : {}),
    ...(Array.isArray(blocked) ? { blockedScripts: blocked.filter((item) => typeof item === "string") } : {}),
  };
}

export function SkillsAdmin({
  entries,
  groupNames,
  marketplaceCount,
}: {
  entries: SkillRow[];
  /** Clearance group keys, read from access/groups.yaml on the server. */
  groupNames: string[];
  /** How many marketplace indexes portal.yaml declares. A config read, no network. */
  marketplaceCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SkillOutcome | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const fileErrors = entries.filter((row) => row.slug === FILE_ERROR_SLUG);
  const skills = entries.filter((row) => row.slug !== FILE_ERROR_SLUG);

  async function send(url: string, init: RequestInit, kind: SkillActionKind, slug: string): Promise<boolean> {
    setPending(true);
    setOutcome(null);
    setFailure(null);
    try {
      const response = await fetch(url, init);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const text = messageForBody(body);
        const reason = (body as { reason?: unknown } | null)?.reason;
        setFailure({ text, ...(typeof reason === "string" ? { reason } : {}) });
        notifyFailure(text);
        return false;
      }
      const result = toOutcome(body, kind, slug);
      setOutcome(result);
      notifySuccess(outcomeHeadline(result));
      router.refresh();
      return true;
    } catch {
      const text = "The skill change could not be submitted.";
      setFailure({ text });
      notifyFailure(text);
      return false;
    } finally {
      setPending(false);
    }
  }

  function postJson(body: unknown, kind: SkillActionKind, slug: string): Promise<boolean> {
    return send(
      "/api/admin/skills",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      kind,
      slug,
    );
  }

  function install(body: InstallBody): Promise<boolean> {
    // The slug is not known until the pipeline reads the skill's frontmatter, so
    // the reply names it and this fallback is only for a reply that somehow does not.
    return postJson(body, "install", body.action === "install-marketplace" ? body.name : body.url);
  }

  function upload(file: File, groups: string[]): Promise<boolean> {
    const form = new FormData();
    form.set("file", file);
    form.set("groups", JSON.stringify(groups));
    // No content-type header: the browser has to set the multipart boundary.
    return send("/api/admin/skills/upload", { method: "POST", body: form }, "install", file.name);
  }

  async function uninstall(slug: string): Promise<void> {
    if (!window.confirm(`Uninstall ${slug}? Its folder is deleted and every cleared session loses it immediately.`)) {
      return;
    }
    await postJson(uninstallBody(slug), "uninstall", slug);
  }

  return (
    <div className="space-y-4">
      {fileErrors.map((row) => (
        <p key={row.reason} role="alert" className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-700 text-pretty">
          access/skills.yaml could not be read, so no skill is offered to anyone: {row.reason}
        </p>
      ))}

      {outcome && <OutcomeBanner outcome={outcome} />}
      {failure && <FailureBanner text={failure.text} reason={failure.reason} />}

      <SkillsInstallForm
        groupNames={groupNames}
        marketplaceCount={marketplaceCount}
        pending={pending}
        onInstall={install}
        onUpload={upload}
      />

      {skills.length === 0 && fileErrors.length === 0 && (
        <p className="rounded-xl bg-surface p-6 text-sm text-ink-muted shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          No skills are installed yet.
        </p>
      )}
      {skills.map((row) => (
        <SkillCard
          key={row.slug}
          row={row}
          groupNames={groupNames}
          pending={pending}
          onUpdate={() => void postJson(updateBody(row.slug), "update", row.slug)}
          onSetGroups={(groups) => postJson(setGroupsBody(row.slug, groups), "groups", row.slug)}
          onUninstall={() => void uninstall(row.slug)}
        />
      ))}
    </div>
  );
}
