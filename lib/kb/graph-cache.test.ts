import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getKbGraph, clearKbGraphCache, GRAPH_CACHE_TTL_MS } from "./graph-cache";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-graph-cache-"));
  clearKbGraphCache();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  clearKbGraphCache();
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("getKbGraph", () => {
  it("serves the cached graph rather than rescanning within the TTL", () => {
    write("one.md", "---\ntitle: One\n---\nbody");
    const first = getKbGraph(root, 1000);

    // A note added after the first build is not visible until the TTL lapses.
    write("two.md", "---\ntitle: Two\n---\nbody");
    expect(getKbGraph(root, 1000 + GRAPH_CACHE_TTL_MS - 1)).toBe(first);
  });

  it("rebuilds once the TTL has lapsed", () => {
    write("one.md", "---\ntitle: One\n---\nbody");
    getKbGraph(root, 1000);

    write("two.md", "---\ntitle: Two\n---\nbody");
    const rebuilt = getKbGraph(root, 1000 + GRAPH_CACHE_TTL_MS + 1);

    expect(rebuilt.nodes).toHaveLength(2);
  });

  it("keys the cache by root, so two clearances never share a graph", () => {
    const other = mkdtempSync(path.join(tmpdir(), "kb-graph-cache-other-"));
    try {
      write("one.md", "---\ntitle: One\n---\nbody");
      writeFileSync(path.join(other, "secret.md"), "---\ntitle: Secret\n---\nbody", "utf8");

      expect(getKbGraph(root, 1000).nodes.map((n) => n.id)).toEqual(["one"]);
      expect(getKbGraph(other, 1000).nodes.map((n) => n.id)).toEqual(["secret"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("degrades to an empty graph instead of throwing when the root cannot be read", () => {
    const graph = getKbGraph(path.join(root, "does-not-exist"), 1000);
    expect(graph).toEqual({ nodes: [], edges: [], total: 0 });
  });

  it("keeps serving the last good graph when a later rebuild fails", () => {
    write("one.md", "---\ntitle: One\n---\nbody");
    const good = getKbGraph(root, 1000);

    rmSync(root, { recursive: true, force: true });
    const afterTtl = getKbGraph(root, 1000 + GRAPH_CACHE_TTL_MS + 1);

    expect(afterTtl).toEqual(good);
  });
});
