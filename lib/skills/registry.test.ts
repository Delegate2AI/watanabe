import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";

/** A well-formed git-sourced entry, so each test only spells out what it varies. */
function gitSkill(slug: string): string[] {
  return [
    `  ${slug}:`,
    `    title: ${slug}`,
    "    source:",
    "      type: git",
    "      url: https://gitlab.example.com/acme/skills.git",
    "      ref: main",
    "      commit: 4f2a91c",
    "    groups: [all-hands]",
  ];
}

function writeSkills(filePath: string, lines: string[]): void {
  writeFileSync(filePath, ["skills:", ...lines, ""].join("\n"));
}

describe("loadSkillRegistry", () => {
  let root: string;
  let filePath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skills-"));
    filePath = path.join(root, "skills.yaml");
    // The loader caches in a single module-level slot keyed by path plus mtime
    // (same shape as lib/connectors/registry.ts), so every test that reads a
    // fresh fixture must invalidate first or it can read a stale value.
    invalidateSkillRegistryCache();
  });

  afterEach(() => {
    invalidateSkillRegistryCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("parses a git-sourced entry and a zip-sourced entry", () => {
    writeSkills(filePath, [
      "  brand-guidelines:",
      "    title: brand-guidelines",
      "    source:",
      "      type: git",
      "      url: https://gitlab.example.com/acme/skills.git",
      "      ref: main",
      "      subdir: brand-guidelines",
      "      commit: 4f2a91c",
      "    groups: [all-hands]",
      "    compat:",
      "      scripts: [scripts/render.py]",
      "      tools: [WebFetch]",
      "  quarterly-report:",
      "    title: Quarterly report",
      "    source:",
      "      type: zip",
      "      filename: quarterly-report.zip",
      "    groups: [finance, leadership]",
    ]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries[0]).toMatchObject({
      slug: "brand-guidelines",
      title: "brand-guidelines",
      source: {
        type: "git",
        url: "https://gitlab.example.com/acme/skills.git",
        ref: "main",
        subdir: "brand-guidelines",
        commit: "4f2a91c",
      },
      groups: ["all-hands"],
      compat: { scripts: ["scripts/render.py"], tools: ["WebFetch"] },
    });
    expect(registry.entries[1]).toMatchObject({
      slug: "quarterly-report",
      source: { type: "zip", filename: "quarterly-report.zip" },
      groups: ["finance", "leadership"],
    });
  });

  it("parses a marketplace-sourced entry", () => {
    writeSkills(filePath, [
      "  pdf-forms:",
      "    title: PDF forms",
      "    source:",
      "      type: marketplace",
      "      index: https://skills.example.com/index.json",
      "      name: pdf-forms",
      "      url: https://github.com/example/skills.git",
      "      commit: 9ab1c22",
      "    groups: [all-hands]",
    ]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries[0].source).toMatchObject({
      type: "marketplace",
      index: "https://skills.example.com/index.json",
      name: "pdf-forms",
    });
  });

  it("defaults compat to empty lists when the entry omits it", () => {
    writeSkills(filePath, gitSkill("brand-guidelines"));

    const registry = loadSkillRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries[0].compat).toEqual({ scripts: [], tools: [] });
  });

  it("sends a reserved-slug entry to errors without blocking other entries", () => {
    writeSkills(filePath, [...gitSkill("brand-guidelines"), ...gitSkill("kb")]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries.map((e) => e.slug)).toEqual(["brand-guidelines"]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("kb");
    expect(registry.errors[0].reason).toContain("reserved");
  });

  it("sends an invalid slug to errors without blocking other entries", () => {
    writeSkills(filePath, [...gitSkill("brand-guidelines"), ...gitSkill("Bad_Slug")]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries.map((e) => e.slug)).toEqual(["brand-guidelines"]);
    expect(registry.errors.map((e) => e.slug)).toEqual(["Bad_Slug"]);
  });

  it("sends an entry missing groups to errors (fail closed)", () => {
    writeSkills(filePath, [
      "  nogroups:",
      "    title: No groups",
      "    source:",
      "      type: zip",
      "      filename: nogroups.zip",
    ]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors.map((e) => e.slug)).toEqual(["nogroups"]);
  });

  it("sends an entry with an unknown source type to errors, healthy entries still load", () => {
    writeSkills(filePath, [
      ...gitSkill("brand-guidelines"),
      "  broken:",
      "    title: Broken",
      "    source:",
      "      type: ftp",
      "      url: ftp://example.com/skill",
      "    groups: [all-hands]",
    ]);

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries.map((e) => e.slug)).toEqual(["brand-guidelines"]);
    expect(registry.errors.map((e) => e.slug)).toEqual(["broken"]);
  });

  it("returns an empty registry for a missing file", () => {
    expect(loadSkillRegistry(path.join(root, "missing.yaml"))).toEqual({
      entries: [],
      errors: [],
    });
  });

  it("reports unparseable YAML as a readable file-level error, not a JSON blob", () => {
    writeFileSync(filePath, "skills: [unclosed\n");

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("*");
    expect(registry.errors[0].reason.trim().startsWith("[")).toBe(false);
  });

  it("reports a wrong top-level shape as a readable file-level error", () => {
    writeFileSync(filePath, "skills: not-a-map\n");

    const registry = loadSkillRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("*");
    expect(registry.errors[0].reason).toContain("skills");
    expect(registry.errors[0].reason.trim().startsWith("[")).toBe(false);
  });

  it("returns the same cached object on a second call with unchanged mtime", () => {
    writeSkills(filePath, gitSkill("brand-guidelines"));

    const first = loadSkillRegistry(filePath);
    const second = loadSkillRegistry(filePath);

    expect(second).toBe(first);
  });

  it("reloads after invalidateSkillRegistryCache() and a rewrite", () => {
    writeSkills(filePath, gitSkill("brand-guidelines"));

    const first = loadSkillRegistry(filePath);
    expect(first.entries).toHaveLength(1);

    invalidateSkillRegistryCache();
    writeSkills(filePath, [...gitSkill("brand-guidelines"), ...gitSkill("quarterly-report")]);

    const second = loadSkillRegistry(filePath);
    expect(second.entries).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it("does not confuse two different files that happen to share an mtime", () => {
    const pathA = path.join(root, "a.yaml");
    const pathB = path.join(root, "b.yaml");
    writeSkills(pathA, gitSkill("brand-guidelines"));
    writeSkills(pathB, gitSkill("quarterly-report"));
    // Force identical mtimes on both files (setting both from the same value,
    // rather than reading one back and reapplying it, avoids a Date round-trip
    // precision mismatch): a single-slot cache keyed only on mtimeMs, not also
    // on path, would treat the second load as a hit for the first file.
    const sharedMtimeSeconds = Date.now() / 1000;
    utimesSync(pathA, sharedMtimeSeconds, sharedMtimeSeconds);
    utimesSync(pathB, sharedMtimeSeconds, sharedMtimeSeconds);
    expect(statSync(pathA).mtimeMs).toBe(statSync(pathB).mtimeMs);

    const registryA = loadSkillRegistry(pathA);
    const registryB = loadSkillRegistry(pathB);

    expect(registryA.entries.map((e) => e.slug)).toEqual(["brand-guidelines"]);
    expect(registryB.entries.map((e) => e.slug)).toEqual(["quarterly-report"]);
  });
});
