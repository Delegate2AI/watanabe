import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { vaultRoot } from "@/lib/repo";
import { IGNORED_PATTERNS } from "@/lib/kb-mcp/constants";
import { parseDoc, type DocEntry } from "./frontmatter";

/** One directory's worth of parsed docs, sorted by path. */
export interface IndexGroup {
  dir: string;
  docs: DocEntry[];
}

/** The whole generated vault index: every doc, grouped by top-level directory. */
export interface IndexMap {
  generatedFrom: string;
  groups: IndexGroup[];
  count: number;
}

/**
 * `IGNORED_PATTERNS` (from `lib/kb-mcp/tools.ts`) plus `memory` and
 * `INDEX.md`: this subsystem also hides the agent's own scratch/memory area,
 * and the generated index snapshot itself, from the generated index, neither
 * of which the read-tool ignore list has any reason to know about. Without
 * excluding `INDEX.md`, a committed snapshot at the vault root would be
 * scanned as a doc and get its own entry, which the snapshot it was rendered
 * from could never have included, making every fresh commit look stale.
 * `isIgnoredRelPath` in that module isn't exported, so its
 * exact-match/prefix-match-for-nested-patterns, any-segment-match-for-bare-
 * names logic is replicated below against this unioned pattern list.
 */
const BUILD_IGNORED_PATTERNS: readonly string[] = [...IGNORED_PATTERNS, "memory", "INDEX.md"];

/** Normalize to forward slashes so pattern matching is OS-independent. */
function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

/**
 * True when `relFromRoot` (already relative, POSIX-normalized) falls under
 * one of `BUILD_IGNORED_PATTERNS`, or has a path segment starting with `.`
 * (dotfile/dotdir convention, e.g. `.git`, `.obsidian`), belt and suspenders
 * alongside the explicit `.obsidian`/`.git` entries already in
 * `IGNORED_PATTERNS`, and catches any dotdir that list doesn't happen to name).
 *
 * A bare (no `/`) pattern is treated as a directory name matched against any
 * path segment (e.g. `memory` hides `memory/` wherever it appears) UNLESS the
 * pattern itself looks like a filename (contains a `.`, e.g. `INDEX.md`), in
 * which case it's matched against the full relative path only, i.e.
 * root-scoped: this is what keeps a generated `INDEX.md` snapshot at the
 * vault root out of its own scan without also swallowing an unrelated nested
 * doc that happens to share that exact name deeper in the tree.
 */
function isIgnoredRelPath(relFromRoot: string): boolean {
  const norm = toPosix(relFromRoot);
  const segments = norm.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith("."))) return true;
  for (const pattern of BUILD_IGNORED_PATTERNS) {
    if (pattern.includes("/")) {
      if (norm === pattern || norm.startsWith(`${pattern}/`)) return true;
    } else if (pattern.includes(".")) {
      if (norm === pattern) return true;
    } else if (segments.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/** Recursively collect vault-relative paths of every non-ignored `.md` file under `absDir`. */
function collectMarkdownPaths(absDir: string, root: string): string[] {
  const out: string[] = [];
  let dirents;
  try {
    dirents = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out; // e.g. a symlink race or permissions error, skip rather than crash the walk
  }
  for (const dirent of dirents) {
    const abs = path.join(absDir, dirent.name);
    const rel = toPosix(path.relative(root, abs));
    if (isIgnoredRelPath(rel)) continue;
    if (dirent.isDirectory()) {
      out.push(...collectMarkdownPaths(abs, root));
    } else if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === ".md") {
      out.push(rel);
    }
  }
  return out;
}

/** The top-level directory a vault-relative path lives under; `"."` for paths at the vault root. */
function topLevelDir(relPath: string): string {
  const segments = relPath.split("/");
  return segments.length > 1 ? segments[0] : ".";
}

/**
 * Recursively scan `root` (default `vaultRoot()`) for `.md` files, parse
 * each via `parseDoc`, and group the results by top-level directory. Ignores
 * everything `IGNORED_PATTERNS` hides plus `memory/` and any dotfile
 * segment (see `isIgnoredRelPath`).
 */
export function buildIndex(root: string = vaultRoot()): IndexMap {
  const resolvedRoot = path.resolve(root);
  const relPaths = collectMarkdownPaths(resolvedRoot, resolvedRoot).sort((a, b) => a.localeCompare(b));

  const byDir = new Map<string, DocEntry[]>();
  for (const relPath of relPaths) {
    const content = readFileSync(path.join(resolvedRoot, relPath), "utf8");
    const doc = parseDoc(relPath, content);
    const dir = topLevelDir(relPath);
    const existing = byDir.get(dir);
    if (existing) existing.push(doc);
    else byDir.set(dir, [doc]);
  }

  const groups: IndexGroup[] = [...byDir.entries()]
    .map(([dir, docs]) => ({ dir, docs }))
    .sort((a, b) => a.dir.localeCompare(b.dir));

  return { generatedFrom: resolvedRoot, groups, count: relPaths.length };
}
