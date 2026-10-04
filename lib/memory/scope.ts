import path from "node:path";
import { memoryWorktreeDir } from "./config";

/**
 * Scope checks for the `mem` MCP tools (see `./mem-tools`). Extracted from
 * `mem-tools.ts` when clearance was threaded through (spec 32), so the tool
 * handlers stay handlers and the access rules are unit-testable on their own.
 *
 * A scope pins a caller to two things:
 *   - their own private subtree, `memory/users/<ownerSlug>/**`
 *   - the shared groups they are cleared for, `memory/shared/<group>/**`
 *
 * The group is a PATH SEGMENT, not frontmatter (spec 32 D32.1): recall builds
 * its prompt synchronously and must not open every shared file to discover
 * visibility.
 *
 * On the dream path these checks are the boundary, since that session runs
 * with `permissionMode: "bypassPermissions"` (see `./dream`) and a
 * prompt-injected transcript cannot talk its way past a path check. That only
 * holds because the dream also restricts its `tools` to the mem MCP tools: an
 * unrestricted session could reach the same files through Bash or Read and
 * never call these functions at all.
 */

export type MemScope = { ownerSlug: string; clearance: string[] };

const SHARED_ROOT = "memory/shared";
const SHARED_PREFIX = `${SHARED_ROOT}/`;
const ALL_HANDS = "all-hands";

/**
 * A group name is one plain path segment. `groups.yaml` keys are unconstrained
 * (`lib/authority/groups.ts` validates member emails, not keys), and clearance
 * is used as PATH INPUT in `./recall`, so an unvalidated key like
 * `../users/victim-at-example.com` would escape the shared tree. Validate once,
 * here, and treat anything else as granting nothing.
 */
const SAFE_GROUP = /^[a-z0-9][a-z0-9._-]*$/i;

export function isSafeGroupName(group: string): boolean {
  return SAFE_GROUP.test(group) && group !== "." && group !== "..";
}

/**
 * Normalize a clearance list for use as a gate or as path input. Tolerates a
 * missing/garbage value at runtime despite the types, because clearance
 * crosses a route boundary and `mem-tools.ts` is a never-throws module: a
 * `TypeError` here would escape the tool handlers, which call these predicates
 * outside their `try` blocks.
 */
export function sanitizeClearance(clearance: unknown): string[] {
  if (!Array.isArray(clearance)) return [];
  return clearance.filter((g): g is string => typeof g === "string" && isSafeGroupName(g));
}

export type SharedClass =
  | { kind: "not-shared" }
  | { kind: "shared-root" }
  | { kind: "legacy" }
  | { kind: "group"; group: string };

/**
 * Recompute the memory-relative path from the already-resolved absolute path
 * (not the raw model-supplied string), so a "../" trick that still resolves
 * inside the worktree cannot dodge a scope check by looking like an allowed
 * prefix before normalization.
 */
export function relativeToMemoryRoot(abs: string): string {
  return path.relative(memoryWorktreeDir(), abs).split(path.sep).join("/");
}

/**
 * Where a memory-relative path sits in the shared tree.
 *
 * A single segment under `memory/shared/` is ambiguous as a string: it is
 * either a legacy flat memory file or a group directory. The `.md` rule
 * settles it, since every memory FILE is markdown (`requireMarkdown` in
 * `./mem-tools` rejects anything else before these checks run) and group
 * directories are named after `groups.yaml` keys. A group named `*.md` would
 * be misread as a legacy file, which is why group names stay plain slugs.
 */
export function classifySharedPath(rel: string): SharedClass {
  if (rel === SHARED_ROOT) return { kind: "shared-root" };
  if (!rel.startsWith(SHARED_PREFIX)) return { kind: "not-shared" };
  const rest = rel.slice(SHARED_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return rest.toLowerCase().endsWith(".md") ? { kind: "legacy" } : { kind: "group", group: rest };
  return { kind: "group", group: rest.slice(0, slash) };
}

/**
 * The caller's own private subtree. An empty `ownerSlug` can't safely build a
 * `memory/users/<slug>/` prefix: it would degrade to `memory/users/`, which
 * matches every user's subtree rather than one. Fail closed instead.
 */
function isOwnPrivatePath(rel: string, scope: MemScope): boolean {
  if (!scope.ownerSlug) return false;
  return rel.startsWith(`memory/users/${scope.ownerSlug}/`);
}

/**
 * Read access to one memory FILE.
 *
 * Legacy flat files under `memory/shared/` read as `all-hands` (spec 32
 * D32.2). They were written when every authenticated user could already read
 * them, so classifying them that way discloses nothing new, while classifying
 * them as restricted would silently drop existing team knowledge out of
 * recall.
 *
 * An empty clearance grants NOTHING under `memory/shared/`, rather than
 * degrading to unrestricted (spec 32 D32.4). The caller's own private subtree
 * is unaffected by clearance.
 */
export function isWithinFileReadScope(abs: string, scope: MemScope): boolean {
  const rel = relativeToMemoryRoot(abs);
  if (isOwnPrivatePath(rel, scope)) return true;
  const cleared = sanitizeClearance(scope.clearance);
  const shared = classifySharedPath(rel);
  if (shared.kind === "legacy") return cleared.includes(ALL_HANDS);
  if (shared.kind === "group") return cleared.includes(shared.group);
  return false;
}

/**
 * Write/delete access to one memory FILE. Same rules as reading, minus legacy:
 * a shared write must name a group directory, so nothing new lands in the
 * unclassified flat tree (spec 32 D32.2).
 */
export function isWithinWriteScope(abs: string, scope: MemScope): boolean {
  const rel = relativeToMemoryRoot(abs);
  if (isOwnPrivatePath(rel, scope)) return true;
  const cleared = sanitizeClearance(scope.clearance);
  const shared = classifySharedPath(rel);
  if (shared.kind === "group") return cleared.includes(shared.group);
  return false;
}

/**
 * Delete access to one memory FILE. Same as writing, except legacy flat files
 * ARE deletable by an all-hands holder (spec 32 D32.5). The spec's stated
 * remedy for a restricted fact discovered in legacy shared memory is
 * `mem_delete` plus a re-dream, so folding delete into the write rule would
 * have removed the only in-product way to clean one up, leaving a manual
 * commit on `portal-memory` as the sole option.
 *
 * Deleting a legacy file is safe to allow where writing one is not: the point
 * of denying legacy writes is that new content must carry a group label, and
 * a delete adds no content.
 */
export function isWithinDeleteScope(abs: string, scope: MemScope): boolean {
  if (isWithinWriteScope(abs, scope)) return true;
  const shared = classifySharedPath(relativeToMemoryRoot(abs));
  return shared.kind === "legacy" && sanitizeClearance(scope.clearance).includes(ALL_HANDS);
}

/**
 * List access to a DIRECTORY. Beyond the file rules, listing must allow the
 * bare container directories a caller needs in order to navigate: the memory
 * root (structural only, revealing just the fixed `shared/`/`users/` names),
 * the shared root (whose CONTENTS are filtered by `visibleSharedRootEntries`),
 * and the caller's own user directory.
 *
 * It must NOT allow listing the bare `memory/users` directory, which would
 * enumerate every other user's slug.
 */
export function isWithinListScope(abs: string, scope: MemScope): boolean {
  const rel = relativeToMemoryRoot(abs);
  if (rel === "memory" || rel === SHARED_ROOT) return true;
  if (scope.ownerSlug !== "" && rel === `memory/users/${scope.ownerSlug}`) return true;
  if (isOwnPrivatePath(rel, scope)) return true;
  const cleared = sanitizeClearance(scope.clearance);
  const shared = classifySharedPath(rel);
  if (shared.kind === "group") return cleared.includes(shared.group);
  if (shared.kind === "legacy") return cleared.includes(ALL_HANDS);
  return false;
}

/**
 * Filter a listing of `memory/shared` down to what the caller may see. Group
 * directories the caller is not cleared for are omitted entirely rather than
 * shown-but-unreadable, so a listing cannot enumerate group names (the same
 * reason `isWithinListScope` refuses to list bare `memory/users`).
 */
export function visibleSharedRootEntries<T extends { name: string; isDir: boolean }>(
  entries: T[],
  clearance: string[],
): T[] {
  const cleared = sanitizeClearance(clearance);
  return entries.filter((e) => (e.isDir ? cleared.includes(e.name) : cleared.includes(ALL_HANDS)));
}
