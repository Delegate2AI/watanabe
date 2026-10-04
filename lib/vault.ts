import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { vaultRoot } from "@/lib/repo";
import { isPathWithinVault } from "@/lib/agent/permissions";

/**
 * Server-side filesystem access for the native web KB view
 * (`app/(site)/[[...slug]]/page.tsx` and `app/(site)/search/page.tsx`).
 *
 * Slug → filesystem resolution here uses the SAME containment check the chat
 * agent's tool gate uses (`isPathWithinVault`, imported from
 * `lib/agent/permissions.ts`) — this is the security-relevant boundary that
 * keeps the web view from ever serving a file outside `vaultRoot()`, and it
 * must not be re-implemented a second time.
 *
 * The ignore list mirrors the Quartz docs-site build's `ignorePatterns`
 * (`quartz/quartz.config.ts` in the KB repo: `.obsidian`, `.claude`,
 * `.harness`, `private`, `templates`, `assets/source`, `assets/data`) so the
 * web view never exposes vault-internal content that the published docs site
 * itself excludes.
 *
 * Every FS-touching function below takes an optional trailing `root`
 * parameter, defaulting to the live `vaultRoot()` — the draft view (spec 12,
 * D22) passes a chat session's `worktreeVaultRoot(sessionId)` instead, so
 * this ONE pipeline (containment, ignore rules, tree-building) renders either
 * the published vault or a staged draft; there is no second read pipeline.
 * `searchVault` is the one exception — it stays live-vault-only (D22).
 */

/** Path prefixes (relative to vaultRoot(), POSIX, no leading slash) that are excluded. */
const IGNORED_PREFIXES = ["private", "templates", "assets/source", "assets/data"];

/**
 * Any path segment starting with "." is ignored — this is a superset of (and
 * covers) Quartz's `.obsidian` / `.claude` / `.harness` entries without having
 * to enumerate dotfiles individually, and also keeps out things Quartz
 * doesn't need to list explicitly because git already ignores them (`.git`,
 * `.DS_Store`, …).
 */
function hasHiddenSegment(relPosix: string): boolean {
  return relPosix.split("/").some((seg) => seg.startsWith("."));
}

/** True when `relPosix` (relative to vaultRoot(), "" = root) must be hidden from the web view. */
export function isIgnoredVaultPath(relPosix: string): boolean {
  if (relPosix === "") return false;
  if (hasHiddenSegment(relPosix)) return true;
  return IGNORED_PREFIXES.some((prefix) => relPosix === prefix || relPosix.startsWith(`${prefix}/`));
}

export interface VaultEntry {
  /** Absolute filesystem path. */
  absPath: string;
  /** Path relative to vaultRoot(), POSIX-separated, no leading slash ("" = vault root). */
  relPath: string;
  /** Route slug segments for this entry ([] at the vault root). */
  slug: string[];
  isDirectory: boolean;
}

/**
 * Resolves route slug segments (as handed to `app/(site)/[[...slug]]` by
 * Next.js — each segment already URL-decoded individually) to a vault
 * filesystem entry.
 *
 * Returns `null` for anything that doesn't exist, is ignored, or — checked via
 * `isPathWithinVault`, the same function the chat agent's PreToolUse gate uses
 * — resolves outside `vaultRoot()`. Callers must treat `null` as "404 via
 * `notFound()`", never leak a filesystem error or an empty page.
 *
 * `root` defaults to the live `vaultRoot()`; the draft view (spec 12 D22)
 * passes a chat session's `worktreeVaultRoot(sessionId)` instead so the SAME
 * resolution/containment logic renders a staged draft rather than the live
 * checkout — every existing caller that omits it keeps reading the live vault
 * exactly as before.
 */
export function resolveVaultEntry(slug: string[] | undefined, root: string = vaultRoot()): VaultEntry | null {
  const segments = slug ?? [];
  // "", ".", ".." segments never appear in a legitimate vault path (the
  // directory listings below only ever emit real child names) — reject them
  // outright rather than letting them fall through to path resolution.
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;

  const relPath = segments.join("/");
  if (isIgnoredVaultPath(relPath)) return null;

  const direct = statVaultPath(relPath, root);
  if (direct) return { absPath: direct.absPath, relPath, slug: segments, isDirectory: direct.isDirectory };

  // Clean-URL support: canonical `.md` page routes omit the extension (see
  // `resolveVaultLink` in lib/vault-links.ts, and the href-building in
  // components/vault/vault-tree.tsx / vault-dir-listing.tsx — all three
  // generate/expect extensionless hrefs for `.md` pages). So a request for
  // `.../doc` that doesn't match anything directly should still resolve to
  // the on-disk `.../doc.md` file, if there is one. `entry.slug` stays the
  // ORIGINAL (extensionless) requested segments — that's the URL-facing
  // identity used for tree/nav highlighting — while `entry.relPath` carries
  // the real on-disk name (with `.md`) for the actual file read.
  if (relPath !== "" && !relPath.toLowerCase().endsWith(".md")) {
    const mdRelPath = `${relPath}.md`;
    if (!isIgnoredVaultPath(mdRelPath)) {
      const md = statVaultPath(mdRelPath, root);
      if (md && !md.isDirectory) {
        return { absPath: md.absPath, relPath: mdRelPath, slug: segments, isDirectory: false };
      }
    }
  }

  return null;
}

function statVaultPath(relPath: string, root: string): { absPath: string; isDirectory: boolean } | null {
  const absPath = path.resolve(root, relPath);
  if (!isPathWithinVault(absPath, root)) return null;
  try {
    const stat = statSync(absPath);
    return { absPath, isDirectory: stat.isDirectory() };
  } catch {
    return null;
  }
}

export interface VaultDirEntry {
  name: string;
  /** Route slug segments for this entry. */
  slug: string[];
  isDirectory: boolean;
}

/**
 * The canonical, extensionless ROUTE slug for a filesystem-derived slug (e.g.
 * `["00-overview", "product-vision.md"]` → `["00-overview", "product-vision"]`).
 * Directories pass through unchanged. Used everywhere an `href` is built from
 * a `VaultDirEntry`/`VaultTreeNode`'s filesystem-derived `slug` — keeps tree
 * links, directory-listing links, and in-content markdown links (see
 * `lib/vault-links.ts#resolveVaultLink`) agreeing on the same clean-URL
 * scheme that `resolveVaultEntry`'s `.md`-fallback above understands.
 */
export function toRouteSlug(slug: string[]): string[] {
  if (slug.length === 0) return slug;
  const last = slug[slug.length - 1];
  if (!last.toLowerCase().endsWith(".md")) return slug;
  return [...slug.slice(0, -1), last.replace(/\.md$/i, "")];
}

/** Lists the non-ignored children of `relPath` (relative to `root`, "" = root). `root` defaults to `vaultRoot()` — see `resolveVaultEntry`'s doc comment for the draft-view use of an explicit root. */
export function listVaultDir(relPath: string, root: string = vaultRoot()): VaultDirEntry[] {
  const absDir = relPath === "" ? root : path.join(root, relPath);

  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return [];
  }

  const entries: VaultDirEntry[] = [];
  for (const name of names) {
    const childRel = relPath === "" ? name : `${relPath}/${name}`;
    if (isIgnoredVaultPath(childRel)) continue;
    const abs = path.join(absDir, name);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(abs).isDirectory();
    } catch {
      continue;
    }
    entries.push({ name, slug: childRel.split("/"), isDirectory });
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export interface VaultTreeNode {
  name: string;
  slug: string[];
  isDirectory: boolean;
  children?: VaultTreeNode[];
}

/** Directories always show up in the tree; files only when they're a `.md` page (the only thing this view renders). */
function belongsInTree(entry: VaultDirEntry): boolean {
  return entry.isDirectory || entry.name.toLowerCase().endsWith(".md");
}

/**
 * Recursively builds the left-nav folder tree from `relPath` down, for the
 * whole vault when called with no argument. `maxDepth` is a defensive cap —
 * this KB is ~40 files/~20 dirs deep, nowhere near it — against ever recursing
 * unboundedly if a future vault turns out to be huge or (in principle) cyclic
 * via a symlink. `root` defaults to `vaultRoot()` — see `resolveVaultEntry`'s
 * doc comment for the draft-view use of an explicit root.
 */
export function buildVaultTree(relPath = "", depth = 0, maxDepth = 12, root: string = vaultRoot()): VaultTreeNode[] {
  if (depth > maxDepth) return [];
  return listVaultDir(relPath, root)
    .filter(belongsInTree)
    .map((entry) => {
      if (!entry.isDirectory) return { name: entry.name, slug: entry.slug, isDirectory: false };
      const childRel = entry.slug.join("/");
      return {
        name: entry.name,
        slug: entry.slug,
        isDirectory: true,
        children: buildVaultTree(childRel, depth + 1, maxDepth, root),
      };
    });
}

/** Reads a vault file's content by its path relative to `root` (defaults to `vaultRoot()`). Returns null on any read failure. */
export function readVaultFile(relPath: string, root: string = vaultRoot()): string | null {
  const abs = relPath === "" ? root : path.join(root, relPath);
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export function findRootLandingDoc(root: string = vaultRoot()): { relPath: string; content: string } | null {
  for (const candidate of ["README.md", "INDEX.md"]) {
    const entry = resolveVaultEntry([candidate], root);
    if (!entry || entry.isDirectory) continue;
    const content = readVaultFile(candidate, root);
    if (content !== null) return { relPath: candidate, content };
  }
  return null;
}

// ── search (v1: simple filename + content substring match) ─────────────────

export interface VaultSearchResult {
  relPath: string;
  slug: string[];
  snippet?: string;
}

const MAX_SEARCH_RESULTS = 40;
const MAX_FILES_SCANNED = 2000;

function walkMarkdownFiles(relDir: string, out: { relPath: string; slug: string[] }[]): void {
  for (const entry of listVaultDir(relDir)) {
    const childRel = entry.slug.join("/");
    if (entry.isDirectory) {
      walkMarkdownFiles(childRel, out);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push({ relPath: childRel, slug: entry.slug });
    }
  }
}

/**
 * Case-insensitive substring search over vault `.md` filenames + content.
 * Deliberately simple (v1: "functional, not fancy" per the KB web-view spec)
 * — no index, no ranking beyond "name match sorts alongside content match",
 * capped scan/result counts so a query against a much larger future vault
 * can't turn into an unbounded full-text scan on every request.
 */
export function searchVault(query: string): VaultSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const files: { relPath: string; slug: string[] }[] = [];
  walkMarkdownFiles("", files);

  const results: VaultSearchResult[] = [];
  for (const file of files.slice(0, MAX_FILES_SCANNED)) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    const nameMatch = file.relPath.toLowerCase().includes(needle);
    const content = readVaultFile(file.relPath);
    const contentIdx = content ? content.toLowerCase().indexOf(needle) : -1;
    if (!nameMatch && contentIdx === -1) continue;

    let snippet: string | undefined;
    if (content && contentIdx !== -1) {
      const start = Math.max(0, contentIdx - 60);
      const end = Math.min(content.length, contentIdx + needle.length + 60);
      snippet = `…${content.slice(start, end).replace(/\s+/g, " ").trim()}…`;
    }
    results.push({ relPath: file.relPath, slug: file.slug, snippet });
  }
  return results;
}
