import { buildBacklinkGraph } from "@/lib/authority/backlinks";
import { listKbFiles } from "./files";
import { groupOf } from "./graph-tasks";

/**
 * The knowledge base as a graph, over a clearance-scoped vault root (spec:
 * 2026-08-13-kb-graph-view-design).
 *
 * Nodes come from `listKbFiles` and edges from `buildBacklinkGraph` inverted.
 * Neither half is new link-extraction code: reusing the backlink builder is what
 * makes this graph and the doc view's "Referenced by" panel the same graph by
 * construction, rather than two extractors that agree until one is edited.
 *
 * The node list has to come from the file listing rather than from the reverse
 * map, because that map only has keys for notes something linked TO. A graph
 * built from it alone has no orphans, and an orphan is one of the few things
 * this view exists to show.
 *
 * Clearance is the root and nothing else: a note the requester is not cleared
 * for is absent from the projection, so it is absent from the node list, absent
 * as an edge endpoint, and absent from the payload. There is no per-node check.
 */

export interface GraphNode {
  /** Extensionless route slug, so a click is `/kb/<id>`. */
  id: string;
  /** Resolved title. */
  t: string;
  /**
   * Top-level directory, empty string for a note at the vault root. The empty
   * string is a real group, not the absence of one: the client ranks it with
   * the rest and labels it "Vault root", the same name `/map`'s list uses.
   */
  g: string;
  /** Degree: the number of distinct neighbours. */
  d: number;
  /**
   * Node kind discriminator, absent for a note. A task node (spec
   * 2026-08-17-kb-task-links-design) carries the task id in `id`, so a click
   * routes to `/tasks/<id>` instead of `/kb/<id>`.
   */
  k?: "task";
}

export interface KbGraph {
  nodes: GraphNode[];
  /** Index pairs into `nodes`, always `[low, high]`, deduplicated. */
  edges: [number, number][];
  /** Node count BEFORE the cap, so the client can say what it is not showing. */
  total: number;
}

/**
 * Past this many nodes both the payload and the force settle get uncomfortable.
 * The builder keeps the highest-degree notes and the client says "showing N of
 * M": a silent truncation would read as "this is the whole graph".
 */
export const GRAPH_NODE_CAP = 3000;

/** Order-independent key for a pair of paths, so A->B and B->A collapse to one edge. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildKbGraph(root: string, cap: number = GRAPH_NODE_CAP): KbGraph {
  const files = listKbFiles(root);
  const known = new Set(files.map((file) => file.relPath));
  const backlinks = buildBacklinkGraph(root);

  // Collapse to undirected pairs. v1 draws no arrows, so a reciprocal link is
  // one line and one relationship; adding arrows later means keeping the
  // direction the backlink builder already gives us here.
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [target, sources] of Object.entries(backlinks)) {
    // The two builders do not share a file walker (`listKbFiles` goes through
    // `listVaultDir` and its ignore rules; `buildBacklinkGraph` has its own
    // walker that only skips dotfiles). Filtering both endpoints to the node
    // set means a divergence degrades to a missing edge, never a dangling index.
    if (!known.has(target)) continue;
    for (const source of sources) {
      if (!known.has(source) || source === target) continue;
      const key = pairKey(source, target);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([source, target]);
    }
  }

  // Degree is counted over ALL pairs, before the cap below removes any node, so
  // a capped graph can show a node whose radius reflects more neighbours than
  // the edges actually drawn around it. That is deliberate: the radius is meant
  // to say how connected the note is in the vault, not in this rendering.
  const degree = new Map<string, number>();
  for (const [source, target] of pairs) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }

  // Rank by degree to decide what survives the cap, then re-sort by route so
  // the node array (and therefore every edge index) is deterministic.
  const kept = [...files]
    .sort((a, b) => {
      const byDegree = (degree.get(b.relPath) ?? 0) - (degree.get(a.relPath) ?? 0);
      return byDegree !== 0 ? byDegree : a.route.localeCompare(b.route);
    })
    .slice(0, cap)
    .sort((a, b) => a.route.localeCompare(b.route));

  const indexOf = new Map(kept.map((file, index) => [file.relPath, index]));
  const nodes: GraphNode[] = kept.map((file) => ({
    id: file.route,
    t: file.title,
    g: groupOf(file.route),
    d: degree.get(file.relPath) ?? 0,
  }));

  const edges: [number, number][] = [];
  for (const [source, target] of pairs) {
    const a = indexOf.get(source);
    const b = indexOf.get(target);
    if (a === undefined || b === undefined) continue;
    edges.push(a < b ? [a, b] : [b, a]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  return { nodes, edges, total: files.length };
}
