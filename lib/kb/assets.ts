import { listVaultDir } from "@/lib/vault";

/**
 * Resolve an authored image `src` to the vault-relative path of the asset it
 * refers to, over a clearance-scoped root (spec 25), or `null` when nothing
 * matches. Mirrors `buildWikilinkResolver` (lib/kb/files.ts): both walk
 * `vaultRootFor(clearance)`, so an asset outside the requester's projection is
 * not in the index and does not resolve. Absence is the boundary; the byte
 * route re-checks clearance regardless.
 *
 * Why an index and not plain relative resolution: this KB is an Obsidian vault,
 * and every image embed in it is authored as a BARE FILENAME
 * (`![](Diagram.png)`), which Obsidian resolves by searching the whole vault for
 * that basename, NOT relative to the note. So a strict relative join would 404
 * every embed. This matches Obsidian's default "shortest path when possible":
 * a bare filename resolves to the shortest-path file with that basename; a
 * path-style src (containing `/`) is resolved relative to the note first, then
 * falls back to a basename match.
 */
export type KbAssetResolver = (src: string | undefined, currentDirSlug: string[]) => string | null;

function walkAssets(relDir: string, root: string, out: string[]): void {
  for (const entry of listVaultDir(relDir, root)) {
    const childRel = entry.slug.join("/");
    if (entry.isDirectory) {
      walkAssets(childRel, root, out);
    } else if (!entry.name.toLowerCase().endsWith(".md")) {
      // Every non-`.md` file is a potential asset (image, PDF, ...); `.md` files
      // are documents, served as HTML by the page, never as bytes.
      out.push(childRel);
    }
  }
}

/** Shortest path wins for an ambiguous basename: fewer segments, then lexicographic. */
function isShorter(candidate: string, current: string): boolean {
  const a = candidate.split("/").length;
  const b = current.split("/").length;
  if (a !== b) return a < b;
  return candidate < current;
}

/** Resolve `./` and `../` in `relPath` against `baseDirSlug`, or null if it climbs above the root. */
function resolveRelative(baseDirSlug: string[], relPath: string): string[] | null {
  const segments = [...baseDirSlug];
  for (const raw of relPath.split("/")) {
    if (raw === "" || raw === ".") continue;
    if (raw === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(raw);
  }
  return segments;
}

export function buildKbAssetResolver(root: string): KbAssetResolver {
  const files: string[] = [];
  walkAssets("", root, files);

  const byPath = new Set(files);
  const byBasename = new Map<string, string>();
  for (const rel of files) {
    const base = (rel.split("/").pop() ?? rel).toLowerCase();
    const existing = byBasename.get(base);
    if (!existing || isShorter(rel, existing)) byBasename.set(base, rel);
  }

  return (src, currentDirSlug) => {
    if (!src) return null;
    const s = src.trim();
    if (s === "") return null;
    // A scheme (`http:`, `data:`...), protocol-relative, or already-absolute
    // path points where it means to: not a vault asset reference.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//") || s.startsWith("/")) return null;

    const pathPart = s.split(/[?#]/)[0];
    if (pathPart === "") return null;

    // Path-style src (contains a slash): try resolving relative to the note
    // first, then fall back to a basename match.
    if (pathPart.includes("/")) {
      const segments = resolveRelative(currentDirSlug, pathPart);
      if (segments) {
        const rel = segments.join("/");
        if (byPath.has(rel)) return rel;
      }
    }

    const base = (pathPart.split("/").pop() ?? pathPart).toLowerCase();
    return byBasename.get(base) ?? null;
  };
}
