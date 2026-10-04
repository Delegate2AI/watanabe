import { describe, expect, it } from "vitest";
import type { KbGraph } from "./graph";
import { overlayTaskNodes, stripTaskNodes, taskAnchorRoute, type KbTaskLink } from "./graph-tasks";

const DOC_GRAPH: KbGraph = {
  nodes: [
    { id: "00-overview/vision", t: "Vision", g: "00-overview", d: 1 },
    { id: "meetings/2026/review-m1", t: "Review", g: "meetings", d: 1 },
  ],
  edges: [[0, 1]],
  total: 2,
};

const TASK: KbTaskLink = {
  id: "task-abc123",
  title: "Publish the summary",
  sourceNotePath: "docs/meetings/2026/review-m1.md",
};

describe("taskAnchorRoute", () => {
  it("turns a stored docs/-prefixed path into the note's route slug", () => {
    expect(taskAnchorRoute("docs/meetings/2026/review-m1.md")).toBe("meetings/2026/review-m1");
  });

  it("strips the extension case-insensitively and tolerates a missing prefix", () => {
    expect(taskAnchorRoute("meetings/2026/review-m1.MD")).toBe("meetings/2026/review-m1");
  });
});

describe("overlayTaskNodes", () => {
  it("appends a task node edged to its source note, inheriting the note's group", () => {
    const graph = overlayTaskNodes(DOC_GRAPH, [TASK]);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[2]).toEqual({ id: "task-abc123", t: "Publish the summary", g: "meetings", d: 1, k: "task" });
    // Appended after the docs, so the doc edge is untouched and the new edge
    // keeps the [low, high] invariant for free.
    expect(graph.edges).toEqual([[0, 1], [1, 2]]);
    // `total` keeps counting notes only.
    expect(graph.total).toBe(2);
  });

  it("skips a task whose source note is not in the projection, silently", () => {
    const outside: KbTaskLink = { ...TASK, id: "task-out", sourceNotePath: "docs/exec/private.md" };
    const graph = overlayTaskNodes(DOC_GRAPH, [outside]);

    // All tasks unanchored degrades to the input graph itself, not a copy.
    expect(graph).toBe(DOC_GRAPH);
  });

  it("returns the input graph itself for an empty task list", () => {
    expect(overlayTaskNodes(DOC_GRAPH, [])).toBe(DOC_GRAPH);
  });

  it("never mutates the input, which may be the shared cached graph", () => {
    const nodesBefore = [...DOC_GRAPH.nodes];
    const edgesBefore = [...DOC_GRAPH.edges];

    overlayTaskNodes(DOC_GRAPH, [TASK]);

    expect(DOC_GRAPH.nodes).toEqual(nodesBefore);
    expect(DOC_GRAPH.edges).toEqual(edgesBefore);
  });
});

describe("stripTaskNodes", () => {
  it("is the overlay's inverse: docs and doc edges survive, tasks and task edges go", () => {
    const overlaid = overlayTaskNodes(DOC_GRAPH, [TASK]);
    const stripped = stripTaskNodes(overlaid);

    expect(stripped.nodes).toEqual(DOC_GRAPH.nodes);
    expect(stripped.edges).toEqual(DOC_GRAPH.edges);
    expect(stripped.total).toBe(DOC_GRAPH.total);
  });

  it("returns a task-free graph itself rather than copying it", () => {
    expect(stripTaskNodes(DOC_GRAPH)).toBe(DOC_GRAPH);
  });
});
