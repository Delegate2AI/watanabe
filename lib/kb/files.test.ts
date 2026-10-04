import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listKbFiles, buildWikilinkResolver } from "./files";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-files-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("listKbFiles", () => {
  it("lists every note in the projection with route, title, and visibility", () => {
    write("00-overview/vision.md", "---\ntitle: Product Vision\n---\nbody");
    write("exec/comp.md", "---\ntitle: Comp\nvisibility: exec\n---\nbody");

    const files = listKbFiles(root);
    const routes = files.map((f) => f.route);
    expect(routes).toContain("00-overview/vision");
    expect(routes).toContain("exec/comp");
    expect(files.find((f) => f.route === "exec/comp")?.visibility).toBe("restricted");
  });
});

describe("buildWikilinkResolver", () => {
  it("resolves by route path, title, and basename", () => {
    write("00-overview/product-vision.md", "---\ntitle: Product Vision\n---\nbody");
    const resolve = buildWikilinkResolver(root);
    expect(resolve("00-overview/product-vision")).toBe("00-overview/product-vision");
    expect(resolve("Product Vision")).toBe("00-overview/product-vision");
    expect(resolve("product-vision")).toBe("00-overview/product-vision");
  });

  it("returns null for a target absent from the projection", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    const resolve = buildWikilinkResolver(root);
    expect(resolve("Exec Comp Plan")).toBeNull();
    expect(resolve("exec/comp")).toBeNull();
  });
});
