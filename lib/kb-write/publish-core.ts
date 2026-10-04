import path from "node:path";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { getGitHost } from "@/lib/git-host";
import { splitMergeRequestTitle } from "@/lib/git-host/title";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { resolveWritableInRoot } from "@/lib/kb-mcp/tools";
import { buildPublishedNote } from "@/lib/artifacts/note";
import { mergeIntoExistingNote } from "./existing-note";
import { sanitizeMrDescription } from "@/lib/packages/mr-description";
import { discard, ensureWorktree, submit, worktreeExists, worktreeVaultRoot } from "@/lib/repo-write";
import { refreshRepo } from "@/lib/repo";
import { isIndexEnabled } from "@/lib/index/config";
import { rebuildIndex } from "@/lib/index/cache";
import { clearKbGraphCache } from "@/lib/kb/graph-cache";

/**
 * Reject a target whose write would follow a symlink out of (or through) the
 * vault. `resolveWritableInRoot` proves LEXICAL containment plus the ignore and system-owned lists, but
 * `mkdir`/`writeFile` follow symlinks, so a symlink committed under `docs/`
 * could still redirect the write. This resolves the deepest ALREADY-EXISTING
 * ancestor of `abs` with `realpath` (which follows every symlink in the chain)
 * and requires it to stay inside the vault's own realpath; it also refuses to
 * write through an existing final symlink even one pointing back inside. New,
 * not-yet-existing components are created as real directories by `mkdir`, so
 * they cannot be symlinks. Returns true when the write is safe.
 */
async function realContained(vaultRoot: string, abs: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await realpath(vaultRoot);
  } catch {
    return false;
  }
  let cursor = abs;
  // Walk up until we hit a component that exists on disk.
  for (;;) {
    try {
      const st = await lstat(cursor);
      if (cursor === abs && st.isSymbolicLink()) return false; // never write through a final symlink
      const real = await realpath(cursor);
      const rel = path.relative(realRoot, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return false;
      cursor = parent;
    }
  }
}

export type PublishMode = "mr" | "direct";

export type PublishResult =
  | { ok: true; mode: "mr"; branch: string; mrUrl: string; mrIid: number | null; notePath: string }
  | { ok: true; mode: "direct"; notePath: string }
  | { ok: false; status: number; error: string };

export interface PublishCoreInput {
  worktreeKey: string;
  title: string;
  body: string;
  visibility: string[];
  targetRel: string;
  mode: PublishMode;
  ownerEmail: string;
  ownerName?: string | null;
  writeToken: string;
  commitMessage: string;
  slug: string;
  mrDescription: string;
  mrDescriptionSuffix?: string;
}

export async function publishCore(input: PublishCoreInput): Promise<PublishResult> {
  try {
    // A prior failed attempt leaves a registered worktree behind; start clean
    // so `submit`'s `git add -A` never folds a stale draft into this publish.
    if (worktreeExists(input.worktreeKey)) await discard(input.worktreeKey);
    await ensureWorktree(input.worktreeKey);

    const vaultRoot = worktreeVaultRoot(input.worktreeKey);
    // Containment + ignore-list via the write path's SINGLE authority (the same
    // check kb_stage_edit routes through), not a hand-rolled copy: this rejects
    // a `..` traversal AND an ignored area (.obsidian, private, assets/source).
    const resolved = resolveWritableInRoot(input.targetRel, vaultRoot);
    if (!resolved.ok) {
      await discard(input.worktreeKey);
      return { ok: false, status: 400, error: "target path is outside the docs/ content area" };
    }
    // Then defend against symlink redirection the lexical check cannot see.
    if (!(await realContained(vaultRoot, resolved.abs))) {
      await discard(input.worktreeKey);
      return { ok: false, status: 400, error: "target path resolves through a symlink outside docs/" };
    }
    const relFromVault = path.relative(vaultRoot, resolved.abs).split(path.sep).join("/");

    // The note is built HERE, not before the worktree exists, because which of
    // the two shapes is correct depends on whether the target already exists in
    // the vault. A new note gets the spec-27 header from the publisher's own
    // values. An EXISTING note keeps its own frontmatter, so a publish can never
    // rewrite the clearance of a note it is only editing the prose of: see
    // `./existing-note.ts` for why that is a refusal rather than a fall-back.
    const existing = await readFile(resolved.abs, "utf8").catch(() => null);
    let note: string;
    if (existing === null) {
      note = buildPublishedNote({ title: input.title, visibility: input.visibility, body: input.body });
    } else {
      const merged = mergeIntoExistingNote({ existing, title: input.title, body: input.body });
      if (!merged.ok) {
        await discard(input.worktreeKey);
        return { ok: false, status: 409, error: merged.error };
      }
      note = merged.note;
    }

    await mkdir(path.dirname(resolved.abs), { recursive: true });
    await writeFile(resolved.abs, note, "utf8");

    const result = await submit(input.worktreeKey, {
      message: input.commitMessage,
      slug: input.slug,
      authorName: input.ownerName ?? input.ownerEmail,
      authorEmail: input.ownerEmail,
      mode: input.mode,
      writeToken: input.writeToken,
    });

    if (!result.ok) {
      const error = "conflict" in result ? `merge conflict in: ${result.files.join(", ")}` : result.error;
      return { ok: false, status: 409, error };
    }

    // `docs/`-prefixed path is what the KB view (spec 25) addresses notes by.
    // Built from the RESOLVED vault-relative path, so it reflects exactly where
    // the note actually landed.
    const notePath = `docs/${relFromVault}`;

    if (input.mode === "direct") {
      // The note is on `main`, but `main` is not what the KB view reads: reads
      // are served from the managed checkout, which only moves when something
      // fast-forwards it. Without this the publish succeeded, the UI said the
      // note was live, and the note was absent from the KB tree, its search and
      // its own URL until the next poll or a restart. `kb_stage_edit` already
      // does exactly this after a direct commit (spec 10 D13); this path did
      // not. Both calls are never-throws by contract, so a refresh failure
      // still reports a real publish as a real publish.
      await refreshRepo();
      if (isIndexEnabled()) {
        rebuildIndex(); // the read checkout now has the note, so the index should too
      }
      clearKbGraphCache(); // same for the TTL-cached link graph and backlink map
      return { ok: true, mode: "direct", notePath };
    }
    // `mr` mode: open the reviewable MR first, then record published only once
    // the MR exists (the branch is already pushed at this point either way).
    const text = splitMergeRequestTitle(
      input.commitMessage,
      `${input.mrDescription}${notePath}.${input.mrDescriptionSuffix ?? ""}`,
    );
    const mr = await getGitHost().createChangeRequest({
      sourceBranch: result.branch,
      title: text.title,
      // Split BEFORE sanitizing, so a commit body carried into the description
      // goes through the same escape as everything else reaching that field.
      description: sanitizeMrDescription(text.description),
      token: input.writeToken,
    });
    captureServerEvent("kb_edit_proposed", {
      distinctId: analyticsIdFor(input.ownerEmail),
      properties: { origin: "publish", notePath },
    });
    return { ok: true, mode: "mr", branch: result.branch, mrUrl: mr.webUrl, mrIid: mr.iid, notePath };
  } catch (error) {
    return { ok: false, status: 500, error: error instanceof Error ? error.message : "failed to publish" };
  }
}
