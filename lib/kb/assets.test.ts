import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildKbAssetResolver } from "./assets";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-assets-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "x");
}

describe("buildKbAssetResolver", () => {
  it("resolves a bare-filename embed by basename, wherever the note lives (Obsidian-style)", () => {
    write("assets/charts/Diagram.png");
    const resolve = buildKbAssetResolver(root);
    // A note deep under assets/ embeds `![](Diagram.png)`; it resolves to the
    // real file, not to the note's own directory.
    expect(resolve("Diagram.png", ["assets", "handoff", "05_visuals"])).toBe(
      "assets/charts/Diagram.png",
    );
  });

  it("picks the shortest path for an ambiguous basename", () => {
    write("assets/charts/Diagram.png"); // 3 segments
    write("assets/handoff/05_visuals/Diagram.png"); // 4 segments
    const resolve = buildKbAssetResolver(root);
    expect(resolve("Diagram.png", [])).toBe("assets/charts/Diagram.png");
  });

  it("matches a basename case-insensitively", () => {
    write("assets/charts/Diagram.png");
    const resolve = buildKbAssetResolver(root);
    expect(resolve("diagram.PNG", [])).toBe("assets/charts/Diagram.png");
  });

  it("resolves a path-style src relative to the note when it exists on disk", () => {
    write("assets/charts/x.png");
    const resolve = buildKbAssetResolver(root);
    expect(resolve("../assets/charts/x.png", ["00-overview"])).toBe("assets/charts/x.png");
  });

  it("falls back to a basename match when a relative path misses", () => {
    write("assets/charts/x.png");
    const resolve = buildKbAssetResolver(root);
    // The relative join points nowhere, but the basename is unique.
    expect(resolve("./x.png", ["00-overview"])).toBe("assets/charts/x.png");
  });

  it("ignores markdown files (they are documents, not assets)", () => {
    write("assets/notes/report.md");
    const resolve = buildKbAssetResolver(root);
    expect(resolve("report.md", [])).toBeNull();
  });

  it("returns null for an unknown asset, and passes through absolute/external/data URLs", () => {
    write("assets/charts/x.png");
    const resolve = buildKbAssetResolver(root);
    expect(resolve("missing.png", [])).toBeNull();
    expect(resolve("/kb/assets/x.png", [])).toBeNull();
    expect(resolve("https://cdn.example.com/x.png", [])).toBeNull();
    expect(resolve("data:image/png;base64,AAAA", [])).toBeNull();
    expect(resolve(undefined, [])).toBeNull();
    expect(resolve("", [])).toBeNull();
  });
});
