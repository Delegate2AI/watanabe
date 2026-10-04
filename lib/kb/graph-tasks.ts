import type { GraphNode, KbGraph } from "./graph";

/**
 * Task nodes overlaid on the KB graph (spec 2026-08-17-kb-task-links-design).
 *
 * The overlay is composed onto a COPY of the cached doc graph at request time,
 * never baked into `graph-cache`: the cache stays a pure function of the
 * clearance root with its existing KB-write invalidation, and a task status
 * change shows up on the next fetch with no new invalidation hook.
 *
 * Anchored-only: a task renders only when its source note is a node in the
 * requester's graph. A task whose note is outside the projection (or dropped
 * by the node cap) is skipped silently; that is the rule, not a failure. Which
 * is also why the SQL side filters by the group half of task visibility only:
 * the attendee grant could only ever admit tasks whose source note is
 * invisible, and anchoring drops those regardless (see spec §D).
 *
 * Pure and never-throws, like `buildKbGraph`. No canvas, no React, no db.
 */

/**
 * The top-level directory of a route slug, or "" for a note at the vault root.
 * Defined HERE, not in `graph.ts`, and imported from there: this module is
 * client-importable (the "Show tasks" toggle strips task nodes in the
 * browser), while `graph.ts` runtime-imports the filesystem-reading builders.
 * The import from `./graph` above must stay type-only for the same reason.
 */
export function groupOf(route: string): string {
  const cut = route.indexOf("/");
  return cut === -1 ? "" : route.slice(0, cut);
}

/** The three columns the overlay needs, as `lib/db/tasks.listKbAnchoredTasks` returns them. */
export interface KbTaskLink {
  id: string;
  title: string;
  /** As stored: `docs/`-prefixed vault path of the source meeting note. */
  sourceNotePath: string;
}

/**
 * A stored `source_note_path` ("docs/meetings/2026/x.md") as a route slug
 * ("meetings/2026/x"). The `docs/` strip is the same defensive one done at
 * `lib/tasks/runner.ts`, `lib/tasks/boot.ts` and the task detail page: the DB
 * stores repo-relative paths while the vault API speaks vault-relative.
 */
export function taskAnchorRoute(sourceNotePath: string): string {
  return sourceNotePath.replace(/^docs\//, "").replace(/\.md$/i, "");
}

/**
 * Returns a NEW graph with one node per anchored task and one edge from each
 * task to its source note. The input may be the shared cached graph and is
 * never mutated. Task nodes are appended AFTER the doc nodes, so every
 * existing edge index is untouched and every new edge keeps the `[low, high]`
 * invariant for free. `total` keeps counting notes only: tasks are an overlay
 * on the map, not part of the note census.
 */
export function overlayTaskNodes(graph: KbGraph, tasks: readonly KbTaskLink[]): KbGraph {
  if (tasks.length === 0) return graph;

  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const nodes = [...graph.nodes];
  const edges: [number, number][] = [...graph.edges];
  for (const task of tasks) {
    const route = taskAnchorRoute(task.sourceNotePath);
    const anchor = indexOf.get(route);
    if (anchor === undefined) continue;
    const node: GraphNode = { id: task.id, t: task.title, g: groupOf(route), d: 1, k: "task" };
    edges.push([anchor, nodes.length]);
    nodes.push(node);
  }
  if (nodes.length === graph.nodes.length) return graph;
  return { nodes, edges, total: graph.total };
}

/**
 * The inverse, for the client's "Show tasks" toggle: the doc-only graph, with
 * every task node and task edge removed. Relies on the append-only layout
 * `overlayTaskNodes` guarantees (docs first, tasks after), so doc edge indices
 * survive unchanged.
 */
export function stripTaskNodes(graph: KbGraph): KbGraph {
  const docCount = graph.nodes.findIndex((node) => node.k === "task");
  if (docCount === -1) return graph;
  return {
    nodes: graph.nodes.slice(0, docCount),
    edges: graph.edges.filter(([a, b]) => a < docCount && b < docCount),
    total: graph.total,
  };
}
