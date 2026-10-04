import { readVaultFile } from "@/lib/vault";
import { getBacklinkGraph } from "./graph-cache";
import { noteMetaFromContent } from "./note";

/**
 * Backlinks ("Referenced by") for a note, over a clearance-scoped vault root
 * (spec 25).
 *
 * The graph comes from `getBacklinkGraph(root)`, a per-root cache over
 * `buildBacklinkGraph(root)` from `vaultRootFor(clearance)` (spec 19): only
 * in-projection notes are nodes, and the graph builder already drops links
 * whose target is not in the projection. So a restricted referrer can never
 * appear here. Absence is the boundary; there is no per-file check.
 */
export interface Backlink {
  /** Extensionless route slug string. */
  route: string;
  title: string;
}

export function backlinksFor(relPath: string, root: string): Backlink[] {
  const graph = getBacklinkGraph(root);
  const referrers = graph[relPath] ?? [];
  return referrers.map((source) => {
    const meta = noteMetaFromContent(source, readVaultFile(source, root) ?? "");
    return { route: source.replace(/\.md$/i, ""), title: meta.title };
  });
}
