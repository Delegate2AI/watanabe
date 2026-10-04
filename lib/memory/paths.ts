import path from "node:path";
import { isPathWithinVault } from "@/lib/agent/permissions";
import { memoryWorktreeDir } from "./config";

/**
 * Layout inside the `portal-memory` worktree:
 *   memory/CLAUDE.md               static governance, loaded every session
 *   memory/shared/<group>/MEMORY.md and <slug>.md   team brain, per group
 *   memory/users/<email-slug>/MEMORY.md and <slug>.md   per-identity notes
 *
 * Legacy (pre-spec-32), still read but never written again:
 *   memory/shared/MEMORY.md        index of the flat shared files below
 *   memory/shared/<slug>.md        ungrouped team brain, treated as all-hands
 *
 * Dead, never read or written (outside the tool layer's writable scope):
 *   memory/MEMORY.md
 *
 * All paths resolve against `memoryWorktreeDir()`; every write is containment-
 * checked with the same `isPathWithinVault` the chat gate uses.
 */

/** Filesystem-safe token for an email: lowercased, `@`→`-at-`, other unsafe chars→`-`. */
export function emailSlug(email: string): string {
  return email
    .trim()
    .toLowerCase()
    .replace(/@/g, "-at-")
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function memoryRoot(): string {
  return path.join(memoryWorktreeDir(), "memory");
}

export function governancePath(): string {
  return path.join(memoryRoot(), "CLAUDE.md");
}

export function sharedDir(): string {
  return path.join(memoryRoot(), "shared");
}

/**
 * The LEGACY flat shared index, read-only.
 *
 * This used to point at `memory/MEMORY.md`, which was a dead end: that path is
 * outside the tool layer's writable scope (`memory/shared/**` or
 * `memory/users/<slug>/**`), so every dream's `mem_write` to the path the seed
 * and the dream prompt both named was denied. On the live `portal-memory`
 * branch, `memory/MEMORY.md` was written once by the seed commit and never
 * again across three dreams, while the dreams instead maintained
 * `memory/shared/MEMORY.md`. Recall was therefore injecting the empty seed
 * placeholder into every prompt and never the real index.
 *
 * Points at the file the dreams actually maintained. Under spec 32 it
 * classifies as `legacy`, so it is readable by an all-hands holder and never
 * written again; new indexes live at `sharedGroupIndexPath(group)`, which is
 * inside the writable tree.
 */
export function sharedIndexPath(): string {
  return path.join(sharedDir(), "MEMORY.md");
}

/**
 * Group-scoped shared memory (spec 32). The group is a path segment, so a
 * scope check can decide visibility without opening the file, which keeps
 * `buildMemoryContextSync` synchronous and proportional to the caller's
 * clearance rather than to the size of shared memory.
 */
export function sharedGroupDir(group: string): string {
  return path.join(sharedDir(), group);
}

export function sharedGroupIndexPath(group: string): string {
  return path.join(sharedGroupDir(group), "MEMORY.md");
}

export function userDir(email: string): string {
  return path.join(memoryRoot(), "users", emailSlug(email));
}

export function userIndexPath(email: string): string {
  return path.join(userDir(email), "MEMORY.md");
}

/**
 * Resolve a worktree-relative path to an absolute path IFF it stays inside the
 * worktree; else `null`. Used by every mem tool before touching the filesystem.
 */
export function resolveInMemory(relPath: string): string | null {
  const root = memoryWorktreeDir();
  if (!isPathWithinVault(relPath, root)) return null;
  return path.resolve(root, relPath);
}
