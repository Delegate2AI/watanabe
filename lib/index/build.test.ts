import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildIndex } from "./build";

describe("buildIndex", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scans a vault, groups by top-level dir, and excludes ignored paths", () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "vault-"));

    writeFileSync(path.join(tmpDir, "overview.md"), "# Overview\n\nThe top-level overview.\n");

    mkdirSync(path.join(tmpDir, "04-economy"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "04-economy", "tokenomics.md"),
      "# Tokenomics\n\nThe token model.\n"
    );
    writeFileSync(
      path.join(tmpDir, "04-economy", "points.md"),
      "# Points\n\nHow points work.\n"
    );

    mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });
    writeFileSync(path.join(tmpDir, ".obsidian", "app.md"), "# Should be excluded\n");

    const index = buildIndex(tmpDir);

    expect(index.generatedFrom).toBe(tmpDir);
    expect(index.count).toBe(3);

    expect(index.groups.map((g) => g.dir)).toEqual([".", "04-economy"]);

    const root = index.groups.find((g) => g.dir === ".");
    expect(root?.docs.map((d) => d.path)).toEqual(["overview.md"]);

    const economy = index.groups.find((g) => g.dir === "04-economy");
    expect(economy?.docs.map((d) => d.path)).toEqual([
      "04-economy/points.md",
      "04-economy/tokenomics.md",
    ]);

    const allPaths = index.groups.flatMap((g) => g.docs.map((d) => d.path));
    expect(allPaths).not.toContain(".obsidian/app.md");
  });

  it("skips a memory/ directory and non-.md files", () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "vault-"));

    writeFileSync(path.join(tmpDir, "overview.md"), "# Overview\n\nOverview text.\n");
    writeFileSync(path.join(tmpDir, "notes.txt"), "not markdown");

    mkdirSync(path.join(tmpDir, "memory"), { recursive: true });
    writeFileSync(path.join(tmpDir, "memory", "log.md"), "# Log\n\nShould be excluded.\n");

    const index = buildIndex(tmpDir);

    expect(index.count).toBe(1);
    const allPaths = index.groups.flatMap((g) => g.docs.map((d) => d.path));
    expect(allPaths).toEqual(["overview.md"]);
  });
});
