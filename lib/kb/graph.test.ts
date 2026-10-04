import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildKbGraph } from "./graph";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-graph-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/** The id of node index `i`, for readable edge assertions. */
function edgeIds(graph: ReturnType<typeof buildKbGraph>): string[][] {
  return graph.edges.map(([a, b]) => [graph.nodes[a].id, graph.nodes[b].id]);
}

describe("buildKbGraph", () => {
  it("builds nodes from every note and edges from the links between them", () => {
    write("a/one.md", "---\ntitle: One\n---\nSee [[two]].");
    write("a/two.md", "---\ntitle: Two\n---\nbody");

    const graph = buildKbGraph(root);

    expect(graph.nodes.map((n) => n.id)).toEqual(["a/one", "a/two"]);
    expect(graph.nodes.map((n) => n.t)).toEqual(["One", "Two"]);
    expect(edgeIds(graph)).toEqual([["a/one", "a/two"]]);
    expect(graph.total).toBe(2);
  });

  it("includes an orphan at degree 0, which the reverse map alone cannot supply", () => {
    write("a/one.md", "---\ntitle: One\n---\nSee [[two]].");
    write("a/two.md", "---\ntitle: Two\n---\nbody");
    write("a/lonely.md", "---\ntitle: Lonely\n---\nnothing links here");

    const graph = buildKbGraph(root);
    const lonely = graph.nodes.find((n) => n.id === "a/lonely");

    expect(lonely).toBeDefined();
    expect(lonely?.d).toBe(0);
  });

  it("counts degree as the number of distinct neighbours", () => {
    write("hub.md", "---\ntitle: Hub\n---\n[[one]] [[two]]");
    write("one.md", "---\ntitle: One\n---\n[[hub]]");
    write("two.md", "---\ntitle: Two\n---\nbody");

    const graph = buildKbGraph(root);
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.d]));

    // hub<->one is reciprocal but is one relationship, so it counts once.
    expect(byId).toEqual({ hub: 2, one: 1, two: 1 });
    expect(graph.edges).toHaveLength(2);
  });

  it("takes the top-level directory as the group, and empty string at the vault root", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    write("README.md", "---\ntitle: Readme\n---\nbody");

    const graph = buildKbGraph(root);
    const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n.g]));

    expect(byId).toEqual({ "00-overview/vision": "00-overview", README: "" });
  });

  it("drops a self-link rather than drawing a node against itself", () => {
    write("solo.md", "---\ntitle: Solo\n---\nsee [[solo]]");

    const graph = buildKbGraph(root);

    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0].d).toBe(0);
  });

  it("keeps the highest-degree notes when capped, and reports the true total", () => {
    write("hub.md", "---\ntitle: Hub\n---\n[[one]] [[two]]");
    write("one.md", "---\ntitle: One\n---\nbody");
    write("two.md", "---\ntitle: Two\n---\nbody");
    write("zzz-orphan.md", "---\ntitle: Orphan\n---\nbody");

    const graph = buildKbGraph(root, 2);

    expect(graph.total).toBe(4);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id)).toContain("hub");
    expect(graph.nodes.map((n) => n.id)).not.toContain("zzz-orphan");
  });

  it("drops an edge whose endpoint was cut by the cap, leaving no dangling index", () => {
    write("hub.md", "---\ntitle: Hub\n---\n[[one]] [[two]]");
    write("one.md", "---\ntitle: One\n---\nbody");
    write("two.md", "---\ntitle: Two\n---\nbody");

    const graph = buildKbGraph(root, 2);

    for (const [a, b] of graph.edges) {
      expect(graph.nodes[a]).toBeDefined();
      expect(graph.nodes[b]).toBeDefined();
    }
  });

  it("is clearance-scoped by the root it is given, with no restricted node or edge", () => {
    // Stands in for two projections: the "open" root simply does not contain
    // the restricted note, exactly as vaultRootFor(clearance) would not.
    write("open/public.md", "---\ntitle: Public\n---\nSee [[secret]].");

    const graph = buildKbGraph(root);

    expect(graph.nodes.map((n) => n.id)).toEqual(["open/public"]);
    // The link to a note outside the projection is not an edge and not a node.
    expect(graph.edges).toEqual([]);
    expect(JSON.stringify(graph)).not.toContain("secret");
  });

  it("returns an empty graph for an empty vault", () => {
    expect(buildKbGraph(root)).toEqual({ nodes: [], edges: [], total: 0 });
  });
});
