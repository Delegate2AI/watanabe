import { buildVaultTree, readVaultFile, toRouteSlug, type VaultTreeNode } from "@/lib/vault";
import { noteMetaFromContent } from "./note";
import type { WikilinkResolver } from "./wikilinks";

/**
 * Flat listing of the notes in a clearance-scoped vault root, plus a wikilink
 * resolver built from it (spec 25).
 *
 * Both walk `vaultRootFor(clearance)` (via the shared `buildVaultTree`), so a
 * note the requester is not cleared for is not in the list and not resolvable
 * as a wikilink target: absence is the boundary.
 */
export interface KbFile {
  /** On-disk rel path, POSIX, with `.md`. */
  relPath: string;
  /** Extensionless route slug string (`foo/bar.md` -> `foo/bar`). */
  route: string;
  title: string;
  visibility: "all-hands" | "restricted";
  group?: string;
}

function flattenFiles(nodes: VaultTreeNode[]): VaultTreeNode[] {
  return nodes.flatMap((node) =>
    node.isDirectory ? flattenFiles(node.children ?? []) : [node],
  );
}

export function listKbFiles(root: string): KbFile[] {
  return flattenFiles(buildVaultTree("", 0, 12, root)).map((node) => {
    const relPath = node.slug.join("/");
    const meta = noteMetaFromContent(relPath, readVaultFile(relPath, root) ?? "");
    return {
      relPath,
      route: toRouteSlug(node.slug).join("/"),
      title: meta.title,
      visibility: meta.visibility,
      group: meta.group,
    };
  });
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\.md$/i, "");
}

/**
 * A resolver for `[[wikilink]]` targets over a clearance-scoped root. Matches a
 * target (as authored) against, in order: the full route path, the note title,
 * then the bare basename. Returns the route string, or `null` when nothing in
 * the projection matches (so the link renders as inert text).
 */
export function buildWikilinkResolver(root: string): WikilinkResolver {
  const files = listKbFiles(root);
  const byRoute = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const byBasename = new Map<string, string>();

  for (const file of files) {
    byRoute.set(norm(file.route), file.route);
    // First writer wins for ambiguous titles/basenames: deterministic and
    // stable given the sorted tree walk.
    if (!byTitle.has(norm(file.title))) byTitle.set(norm(file.title), file.route);
    const basename = file.route.split("/").pop() ?? file.route;
    if (!byBasename.has(norm(basename))) byBasename.set(norm(basename), file.route);
  }

  return (target: string): string | null => {
    const key = norm(target.split("/").map((s) => s.trim()).join("/"));
    return byRoute.get(key) ?? byTitle.get(key) ?? byBasename.get(key) ?? null;
  };
}
