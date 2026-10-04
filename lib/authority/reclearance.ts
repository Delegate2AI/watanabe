import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { getGitHost } from "@/lib/git-host";
import { splitMergeRequestTitle } from "@/lib/git-host/title";
import { log } from "@/lib/log";
import { memoryWorktreeDir } from "@/lib/memory/config";
import { sanitizeMrDescription } from "@/lib/packages/mr-description";
import { discard, ensureWorktree, submit, worktreeVaultRoot } from "@/lib/repo-write";
import { isAuthorityEnabled } from "./config";
import { loadGroups } from "./groups";
import { can, loadRoles } from "./roles";

export interface ReclearanceResult {
  ok: boolean;
  error?: string;
  /** The pushed branch. Present on success, and on a `review_unavailable` failure, where the branch exists but no merge request does. */
  branch?: string;
  /** The merge request opened against `branch`, which is what a reviewer actually acts on. */
  mrUrl?: string;
}

interface ReclearanceOptions {
  accessRoot?: string;
}

function normalizedNotePath(notePath: string): string | null {
  const relative = notePath.replace(/^docs\//, "");
  if (!relative.startsWith("meetings/") || !relative.endsWith(".md")) return null;
  const normalized = path.posix.normalize(relative);
  return normalized.startsWith("meetings/") ? normalized : null;
}

function rewriteVisibility(content: string, visibility: string[]): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return null;
  const metadata = document.toJS() as { type?: unknown };
  if (metadata.type !== "meeting") return null;
  document.set("visibility", visibility);
  return `---\n${document.toString()}---${content.slice(match[0].length - match[2].length)}`;
}

export async function reclearMeeting(
  notePath: string,
  visibility: string[],
  actorEmail: string,
  options: ReclearanceOptions = {},
): Promise<ReclearanceResult> {
  const accessRoot = options.accessRoot ?? memoryWorktreeDir();
  const roles = loadRoles(path.join(accessRoot, "access", "roles.yaml"));
  if (!can(actorEmail, "manageAccess", roles)) return { ok: false, error: "forbidden" };
  if (!isAuthorityEnabled()) return { ok: false, error: "feature disabled" };

  const relative = normalizedNotePath(notePath);
  const uniqueVisibility = [...new Set(visibility.map((group) => group.trim()).filter(Boolean))].sort();
  const groups = loadGroups(path.join(accessRoot, "access", "groups.yaml"));
  // Object.hasOwn, not the `in` operator: `in` resolves prototype keys, so a
  // visibility label of "__proto__" or "constructor" would falsely validate.
  if (!relative || uniqueVisibility.length === 0 || uniqueVisibility.some((group) => !Object.hasOwn(groups, group))) {
    return { ok: false, error: "valid meeting visibility is required" };
  }
  const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
  if (!writeToken) return { ok: false, error: "write_unavailable" };

  const actor = actorEmail.trim().toLowerCase();
  const threadId = `reclear-${randomUUID()}`;
  try {
    await ensureWorktree(threadId);
    const target = path.join(worktreeVaultRoot(threadId), relative);
    const rewritten = rewriteVisibility(readFileSync(target, "utf8"), uniqueVisibility);
    if (!rewritten) {
      await discard(threadId);
      return { ok: false, error: "meeting note is not valid for re-clearance" };
    }
    writeFileSync(target, rewritten, "utf8");
    const commitMessage = `fix(meeting): re-clear ${path.basename(relative)}`;
    const result = await submit(threadId, {
      message: commitMessage,
      slug: `reclear-${path.basename(relative, ".md").replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`,
      authorName: actor,
      authorEmail: actor,
      mode: "mr",
      writeToken,
    });
    if (!result.ok) return { ok: false, error: "re-clearance submission failed" };
    // `submit` pushes the branch and stops. Without this call the re-clearance
    // sat on the remote with no merge request for anyone to find, while the UI
    // said it had been submitted for review and told the admin to merge it.
    // Every other `mr`-mode writer opens the merge request itself; this one did
    // not (see `lib/kb-write/publish-core.ts` and `lib/packages/runner.ts`).
    try {
      const text = splitMergeRequestTitle(
        commitMessage,
        `Re-clears docs/${relative} to: ${uniqueVisibility.join(", ")}.\nRequested by ${actor}.`,
      );
      const mr = await getGitHost().createChangeRequest({
        sourceBranch: result.branch,
        title: text.title,
        // The groups are validated against groups.yaml and the path against
        // `meetings/**.md` above, so neither can carry a line-leading quick
        // action. Sanitized anyway: nothing reaching GitLab's description field
        // is exempt from that escape (see `lib/packages/mr-description.ts`).
        description: sanitizeMrDescription(text.description),
        token: writeToken,
      });
      return { ok: true, branch: result.branch, mrUrl: mr.webUrl };
    } catch (error) {
      // The branch is already pushed, so the change is not lost and a retry
      // would only push a second one. The branch name travels in the log, where
      // an operator can act on it, and never into the response body.
      log.error("re-clearance merge request failed", {
        branch: result.branch,
        err: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: "review_unavailable", branch: result.branch };
    }
  } catch {
    await discard(threadId);
    return { ok: false, error: "meeting note is not valid for re-clearance" };
  }
}
