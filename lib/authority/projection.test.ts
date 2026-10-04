import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndexMap } from "@/lib/index/build";
import { buildIndex } from "@/lib/index/build";
import { buildBacklinkGraph } from "./backlinks";
import { buildProjection } from "./projection";

describe("buildProjection", () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    sourceRoot = mkdtempSync(path.join(os.tmpdir(), "authority-source-"));
    outputRoot = mkdtempSync(path.join(os.tmpdir(), "authority-output-"));
    mkdirSync(path.join(sourceRoot, "notes"), { recursive: true });
    writeFileSync(
      path.join(sourceRoot, "notes", "public.md"),
      "---\ntitle: Public\n---\nSee [Exec plan](exec.md).\n",
    );
    writeFileSync(
      path.join(sourceRoot, "notes", "exec.md"),
      "---\ntitle: Exec plan\nvisibility: exec\n---\nSecret roadmap.\n",
    );
    writeFileSync(
      path.join(sourceRoot, "notes", "broken.md"),
      "---\ntitle: Broken\nvisibility: [exec\n---\nMust not leak.\n",
    );
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("physically excludes restricted and unparseable notes", () => {
    const projection = buildProjection(["all-hands"], "sha-public", { sourceRoot, outputRoot });

    expect(readFileSync(path.join(projection, "notes", "public.md"), "utf8")).toContain("Public");
    expect(() => readFileSync(path.join(projection, "notes", "exec.md"), "utf8")).toThrow();
    expect(() => readFileSync(path.join(projection, "notes", "broken.md"), "utf8")).toThrow();
  });

  it("copies only assets reachable from visible notes", () => {
    mkdirSync(path.join(sourceRoot, "assets"));
    writeFileSync(path.join(sourceRoot, "assets", "public.png"), "public-image");
    writeFileSync(path.join(sourceRoot, "assets", "secret.png"), "secret-image");
    writeFileSync(
      path.join(sourceRoot, "notes", "public.md"),
      "---\ntitle: Public\n---\n![Chart](../assets/public.png)\n",
    );
    writeFileSync(
      path.join(sourceRoot, "notes", "exec.md"),
      "---\ntitle: Exec plan\nvisibility: exec\n---\n![[../assets/secret.png]]\n",
    );

    const projection = buildProjection(["all-hands"], "sha-assets", { sourceRoot, outputRoot });

    expect(readFileSync(path.join(projection, "assets", "public.png"), "utf8")).toBe("public-image");
    expect(() => readFileSync(path.join(projection, "assets", "secret.png"), "utf8")).toThrow();
  });

  it("does not write unused authority metadata artifacts", () => {
    const projection = buildProjection(["all-hands"], "sha-no-metadata", {
      sourceRoot,
      outputRoot,
    });

    expect(existsSync(path.join(projection, ".authority"))).toBe(false);
  });

  it("builds index and backlinks only from included notes", () => {
    const projection = buildProjection(["all-hands"], "sha-public", { sourceRoot, outputRoot });
    const index = buildIndex(projection) as IndexMap;
    const backlinks = buildBacklinkGraph(projection);
    const indexedPaths = index.groups.flatMap((group) => group.docs.map((doc) => doc.path));

    expect(indexedPaths).toEqual(["notes/public.md"]);
    expect(JSON.stringify(backlinks)).not.toContain("exec.md");
  });

  it("includes every parseable note for admins", () => {
    const projection = buildProjection(["all-hands", "admins"], "sha-admin", {
      sourceRoot,
      outputRoot,
    });
    const index = buildIndex(projection) as IndexMap;
    const indexedPaths = index.groups.flatMap((group) => group.docs.map((doc) => doc.path));

    expect(readFileSync(path.join(projection, "notes", "exec.md"), "utf8")).toContain("Secret roadmap");
    expect(readFileSync(path.join(projection, "notes", "broken.md"), "utf8")).toContain("Must not leak");
    expect(indexedPaths).toEqual(["notes/broken.md", "notes/exec.md", "notes/public.md"]);
  });
});
