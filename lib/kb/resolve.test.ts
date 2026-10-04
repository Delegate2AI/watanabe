import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveKbDoc } from "./resolve";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-resolve-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("resolveKbDoc", () => {
  it("resolves an extensionless slug to a parsed note", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\ntype: canon\n---\n# Vision\n\nBody.");
    const res = resolveKbDoc(["00-overview", "vision"], root);
    expect(res?.kind).toBe("doc");
    if (res?.kind === "doc") {
      expect(res.note.title).toBe("Vision");
      expect(res.note.type).toBe("canon");
      expect(res.note.body).toContain("Body.");
    }
  });

  it("resolves a directory slug to a dir result", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    const res = resolveKbDoc(["00-overview"], root);
    expect(res?.kind).toBe("dir");
  });

  it("returns null for an unknown slug (404)", () => {
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    expect(resolveKbDoc(["does", "not", "exist"], root)).toBeNull();
  });

  it("returns null for a restricted note absent from an all-hands root (404, indistinguishable from missing)", () => {
    // The exec note is not written into this all-hands projection.
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");
    expect(resolveKbDoc(["exec", "comp"], root)).toBeNull();
  });

  it("returns null for a non-markdown file (an image is not a doc; the asset route serves it)", () => {
    // A binary asset must never be resolved as a doc and rendered inline: it is
    // served as raw bytes by /kb/assets. Here it resolves to null -> 404.
    write("assets/charts/diagram.png", "\x89PNG\r\n\x1a\n-not-markdown-");
    expect(resolveKbDoc(["assets", "charts", "diagram.png"], root)).toBeNull();
  });
});
