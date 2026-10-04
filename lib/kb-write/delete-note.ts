import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, realpath, unlink } from "node:fs/promises";
import { getGitHost } from "@/lib/git-host";
import { splitMergeRequestTitle } from "@/lib/git-host/title";
import { resolveWritableInRoot } from "@/lib/kb-mcp/tools";
import { sanitizeMrDescription } from "@/lib/packages/mr-description";
import { discard, ensureWorktree, submit, worktreeExists, worktreeVaultRoot } from "@/lib/repo-write";

export type DeleteNoteResult =
  | { ok: true; branch: string; mrUrl: string }
  | {
      ok: false;
      reason: "not_found" | "forbidden" | "write_unavailable" | "conflict" | "failed";
      detail?: string;
    };

export interface ProposeNoteDeletionInput {
  /** Vault-relative path to the note, with or without the `docs/` prefix. */
  relPath: string;
  actorEmail: string;
  actorName: string;
}

/** `exec/comp.md` -> `delete-comp`, a safe branch slug for `submit`. */
function branchSlug(relFromVault: string): string {
  const base = path.posix.basename(relFromVault).replace(/\.md$/i, "");
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `delete-${slug || "note"}`;
}

/**
 * Whether the note really lives inside the vault. `resolveWritableInRoot` proves lexical
 * containment; this refuses a target that IS a symlink and one reached through
 * a symlinked ancestor, either of which would unlink a file outside `docs/`.
 */
async function realTarget(
  vaultRoot: string,
  abs: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "forbidden" }> {
  let stats;
  try {
    stats = await lstat(abs);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (stats.isSymbolicLink()) return { ok: false, reason: "forbidden" };
  if (!stats.isFile()) return { ok: false, reason: "not_found" };
  try {
    const rel = path.relative(await realpath(vaultRoot), await realpath(abs));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, reason: "forbidden" };
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true };
}

/**
 * Stage one note's removal in an ephemeral worktree and propose it as a merge
 * request. Nothing lands on `main` here: the review queue is where a deletion is
 * approved, so there is no post-merge refresh to run.
 */
export async function proposeNoteDeletion(input: ProposeNoteDeletionInput): Promise<DeleteNoteResult> {
  const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
  if (!writeToken) return { ok: false, reason: "write_unavailable" };

  const worktreeKey = `delete-${randomUUID().replace(/-/g, "")}`;
  try {
    // A prior failed attempt leaves a registered worktree behind; start clean so
    // `submit`'s `git add -A` never folds a stale draft into this deletion.
    if (worktreeExists(worktreeKey)) await discard(worktreeKey);
    await ensureWorktree(worktreeKey);

    const vaultRoot = worktreeVaultRoot(worktreeKey);
    const resolved = resolveWritableInRoot(input.relPath.trim().replace(/^docs\//, ""), vaultRoot);
    if (!resolved.ok) {
      await discard(worktreeKey);
      return { ok: false, reason: "forbidden" };
    }
    const real = await realTarget(vaultRoot, resolved.abs);
    if (!real.ok) {
      await discard(worktreeKey);
      return { ok: false, reason: real.reason };
    }

    const relFromVault = path.relative(vaultRoot, resolved.abs).split(path.sep).join("/");
    const notePath = `docs/${relFromVault}`;
    await unlink(resolved.abs);

    const message = `Delete ${notePath}`;
    // Always `mr`, whatever `KB_WRITE_MODE` says: a deletion is always reviewable.
    const result = await submit(worktreeKey, {
      message,
      slug: branchSlug(relFromVault),
      authorName: input.actorName || input.actorEmail,
      authorEmail: input.actorEmail,
      mode: "mr",
      writeToken,
    });
    if (!result.ok) {
      // The worktree is left intact, as `submit` documents: a conflict is
      // retryable and nothing here discards work.
      if ("conflict" in result) {
        return { ok: false, reason: "conflict", detail: `merge conflict in: ${result.files.join(", ")}` };
      }
      return { ok: false, reason: "failed", detail: result.error };
    }

    const text = splitMergeRequestTitle(
      message,
      `${input.actorName || input.actorEmail} (${input.actorEmail}) proposed removing ${notePath} from the knowledge base.`,
    );
    const mr = await getGitHost().createChangeRequest({
      sourceBranch: result.branch,
      title: text.title,
      description: sanitizeMrDescription(text.description),
      token: writeToken,
    });
    return { ok: true, branch: result.branch, mrUrl: mr.webUrl };
  } catch (error) {
    return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : undefined };
  }
}
