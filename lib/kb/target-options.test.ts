import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { kbTargetOptions } from "./target-options";

/**
 * Fixture "projection" directories passed directly as the root, mirroring the
 * real call site (`vaultRootFor(clearance)`): an uncleared note simply is not
 * written into the fixture, so absence stays the boundary.
 */
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "kb-targets-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

describe("kbTargetOptions", () => {
  it("lists nested folders and existing notes with titles", () => {
    write("handbook/hr/onboarding.md", "---\ntitle: Onboarding\n---\nbody");
    write("handbook/tools.md", "---\ntitle: Tools\n---\nbody");
    write("00-overview/vision.md", "---\ntitle: Vision\n---\nbody");

    const options = kbTargetOptions(root);
    expect(options.dirs).toEqual(["00-overview", "handbook", "handbook/hr"]);
    expect(options.notes).toEqual([
      { path: "00-overview/vision.md", title: "Vision" },
      { path: "handbook/hr/onboarding.md", title: "Onboarding" },
      { path: "handbook/tools.md", title: "Tools" },
    ]);
  });

  it("skips non-markdown files", () => {
    write("assets/logo.png", "binary-ish");
    write("assets/readme.md", "---\ntitle: Readme\n---\nbody");

    const options = kbTargetOptions(root);
    expect(options.notes.map((note) => note.path)).toEqual(["assets/readme.md"]);
  });

  it("returns empty lists for an unreadable root instead of throwing", () => {
    expect(kbTargetOptions(path.join(root, "does-not-exist"))).toEqual({ dirs: [], notes: [] });
  });
});
