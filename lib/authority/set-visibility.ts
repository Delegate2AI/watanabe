import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { isFlagEnabled } from "@/lib/config/flags";
import { getGitHost } from "@/lib/git-host";
import { splitMergeRequestTitle } from "@/lib/git-host/title";
import { log } from "@/lib/log";
import { memoryWorktreeDir } from "@/lib/memory/config";
import { sanitizeMrDescription } from "@/lib/packages/mr-description";
import { discard, ensureWorktree, submit, worktreeVaultRoot } from "@/lib/repo-write";
import { isAuthorityEnabled } from "./config";
import { loadGroups } from "./groups";
import { can, loadRoles } from "./roles";

export interface SetVisibilityResult {
  ok: boolean;
  error?: string;
  branch?: string;
  mrUrl?: string;
  count?: number;
  skipped?: string[];
}

interface Options {
  accessRoot?: string;
}

/** `KB_WRITE_MODE`: `"direct"` pushes straight to main, otherwise a Merge Request. Mirrors lib/kb-mcp/write-tools.ts. */
function writeMode(): "mr" | "direct" {
  return process.env.KB_WRITE_MODE?.trim().toLowerCase() === "direct" ? "direct" : "mr";
}

/** Normalize a caller-supplied vault-relative path: strip a leading `docs/`, reject traversal/absolute. */
function normalizeTarget(target: string): string | null {
  const stripped = target.replace(/^docs\//, "");
  if (path.isAbsolute(stripped)) return null;
  const normalized = path.posix.normalize(stripped);
  if (normalized === "" || normalized === "." || normalized.startsWith("..") || normalized.includes("/../")) return null;
  return normalized;
}

/** Rewrite a note's `visibility:` frontmatter, preserving every other field and the body. Returns null when there is no parseable frontmatter. */
function rewriteVisibility(content: string, visibility: string[]): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) return null;
  document.set("visibility", visibility);
  return `---\n${document.toString()}---${content.slice(match[0].length - match[2].length)}`;
}

/** Every `.md` file under `dir` (recursive), returned as absolute paths. */
export function markdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(dir, entry.name);
      return entry.isDirectory() ? markdownFiles(absolute) : entry.name.endsWith(".md") ? [absolute] : [];
    });
  } catch {
    return [];
  }
}

export async function setNoteVisibility(
  target: string,
  visibility: string[],
  actorEmail: string,
  options: Options = {},
): Promise<SetVisibilityResult> {
  const accessRoot = options.accessRoot ?? memoryWorktreeDir();
  const roles = loadRoles(path.join(accessRoot, "access", "roles.yaml"));
  if (!can(actorEmail, "manageAccess", roles)) return { ok: false, error: "forbidden" };
  if (!isAuthorityEnabled() || !isFlagEnabled("KB_ACCESS_UI_ENABLED")) return { ok: false, error: "feature disabled" };

  const relTarget = normalizeTarget(target);
  const groups = loadGroups(path.join(accessRoot, "access", "groups.yaml"));
  const uniqueVisibility = [...new Set(visibility.map((g) => g.trim()).filter(Boolean))].sort();
  // Object.hasOwn, not `in`: `in` resolves prototype keys, so "__proto__"/"constructor" would falsely validate.
  if (!relTarget || uniqueVisibility.length === 0 || uniqueVisibility.some((g) => !Object.hasOwn(groups, g))) {
    return { ok: false, error: "valid visibility is required" };
  }
  const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
  if (!writeToken) return { ok: false, error: "write_unavailable" };

  const actor = actorEmail.trim().toLowerCase();
  const threadId = `setvis-${randomUUID()}`;
  try {
    await ensureWorktree(threadId);
    const vaultDir = worktreeVaultRoot(threadId);
    const absTarget = path.join(vaultDir, relTarget);
    // Containment guard: the resolved path must stay inside the vault.
    if (path.relative(vaultDir, absTarget).startsWith("..")) {
      await discard(threadId);
      return { ok: false, error: "valid visibility is required" };
    }

    const stat = statSync(absTarget, { throwIfNoEntry: false });
    if (!stat) {
      await discard(threadId);
      return { ok: false, error: "path not found" };
    }
    const targets = stat.isDirectory() ? markdownFiles(absTarget) : absTarget.endsWith(".md") ? [absTarget] : [];
    if (targets.length === 0) {
      await discard(threadId);
      return { ok: false, error: "no writable notes at path" };
    }

    const skipped: string[] = [];
    let count = 0;
    for (const file of targets) {
      const rewritten = rewriteVisibility(readFileSync(file, "utf8"), uniqueVisibility);
      if (rewritten === null) {
        skipped.push(path.relative(vaultDir, file));
        continue;
      }
      writeFileSync(file, rewritten, "utf8");
      count += 1;
    }
    if (count === 0) {
      await discard(threadId);
      return { ok: false, error: "no writable notes at path", skipped };
    }

    const base = path.basename(relTarget) || "vault";
    const message = `chore(access): set visibility on ${base}`;
    const mode = writeMode();
    const result = await submit(threadId, {
      message,
      slug: `setvis-${base.replace(/\.md$/i, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`,
      authorName: actor,
      authorEmail: actor,
      mode,
      writeToken,
    });
    if (!result.ok) return { ok: false, error: "visibility submission failed" };
    if (mode === "direct") return { ok: true, branch: result.branch, count, skipped };
    try {
      const text = splitMergeRequestTitle(
        message,
        `Sets visibility on docs/${relTarget} (${count} ${count === 1 ? "note" : "notes"}) to: ${uniqueVisibility.join(", ")}.\nRequested by ${actor}.`,
      );
      const mr = await getGitHost().createChangeRequest({
        sourceBranch: result.branch,
        title: text.title,
        description: sanitizeMrDescription(text.description),
        token: writeToken,
      });
      return { ok: true, branch: result.branch, mrUrl: mr.webUrl, count, skipped };
    } catch (error) {
      log.error("visibility change request failed", {
        branch: result.branch,
        err: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: "review_unavailable", branch: result.branch };
    }
  } catch {
    await discard(threadId).catch(() => {});
    return { ok: false, error: "visibility update failed" };
  }
}
