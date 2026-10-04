import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCompatReport, MAX_COMPAT_ITEMS, MAX_COMPAT_ITEM_CHARS } from "./compat";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";
import { EntrySchema, MAX_SKILL_TITLE_CHARS } from "./types";
import { MAX_SKILL_NAME_CHARS } from "./validate";

/**
 * Caps on the strings access/skills.yaml persists. Task 2 capped what the
 * validator lets out of an untrusted folder; these are the caps on the schema
 * itself, which is the more direct exposure: a hand-edited registry file never
 * goes through the validator at all.
 */

const SOURCE = { type: "git", url: "https://git.example/s.git", ref: "main", commit: "abc123" };

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "Demo", source: SOURCE, groups: ["eng"], ...overrides };
}

let root: string;
let registryPath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-caps-"));
  registryPath = path.join(root, "skills.yaml");
  invalidateSkillRegistryCache();
});

afterEach(() => {
  invalidateSkillRegistryCache();
  rmSync(root, { recursive: true, force: true });
});

describe("EntrySchema caps", () => {
  it("caps a persisted title at the length the validator caps a frontmatter name", () => {
    expect(MAX_SKILL_TITLE_CHARS).toBe(MAX_SKILL_NAME_CHARS);
  });

  it("accepts a title exactly at the cap", () => {
    const title = "t".repeat(MAX_SKILL_TITLE_CHARS);

    expect(EntrySchema.safeParse(entry({ title })).success).toBe(true);
  });

  it("rejects a title one character over the cap", () => {
    const title = "t".repeat(MAX_SKILL_TITLE_CHARS + 1);

    expect(EntrySchema.safeParse(entry({ title })).success).toBe(false);
  });

  it("rejects a compat list with far more items than the compat report can produce", () => {
    const tools = Array.from({ length: MAX_COMPAT_ITEMS + 50 }, (_unused, i) => `Tool${i}`);

    expect(EntrySchema.safeParse(entry({ compat: { scripts: [], tools } })).success).toBe(false);
  });

  it("rejects a compat item far longer than the compat report can produce", () => {
    const tools = ["X".repeat(MAX_COMPAT_ITEM_CHARS * 10)];

    expect(EntrySchema.safeParse(entry({ compat: { scripts: [], tools } })).success).toBe(false);
  });

  it("rejects an over-long script path too, not only tools", () => {
    const scripts = ["s".repeat(MAX_COMPAT_ITEM_CHARS * 10)];

    expect(EntrySchema.safeParse(entry({ compat: { scripts, tools: [] } })).success).toBe(false);
  });

  it("accepts the most truncated report buildCompatReport can produce", () => {
    // The trap this pins: capList clips each item to MAX_COMPAT_ITEM_CHARS and
    // then APPENDS a truncation marker, and appends one "+N more" item beyond
    // the item cap. A schema cap set to the raw Task 2 numbers would reject the
    // validator's own output.
    const files = Array.from({ length: MAX_COMPAT_ITEMS + 25 }, (_unused, i) => ({
      rel: `${"d".repeat(MAX_COMPAT_ITEM_CHARS * 3)}/${i}.sh`,
      bytes: 1,
      executable: true,
    }));
    const declared = Array.from({ length: MAX_COMPAT_ITEMS + 25 }, (_unused, i) => `${"T".repeat(MAX_COMPAT_ITEM_CHARS * 3)}${i}`);
    const report = buildCompatReport(files, declared, "no urls here");
    const compat = { scripts: report.scripts, tools: report.tools };

    expect(EntrySchema.safeParse(entry({ compat })).success).toBe(true);
  });
});

describe("registry isolation under the new caps", () => {
  it("disables an over-cap entry and still loads its healthy siblings", () => {
    const huge = "t".repeat(MAX_SKILL_TITLE_CHARS + 1);
    writeFileSync(
      registryPath,
      [
        "skills:",
        "  fine:",
        "    title: Fine",
        "    source:",
        "      type: git",
        "      url: https://git.example/s.git",
        "      ref: main",
        "      commit: abc123",
        "    groups: [eng]",
        "  huge:",
        `    title: ${huge}`,
        "    source:",
        "      type: git",
        "      url: https://git.example/s.git",
        "      ref: main",
        "      commit: abc123",
        "    groups: [eng]",
        "",
      ].join("\n"),
    );

    const registry = loadSkillRegistry(registryPath);

    expect(registry.entries.map((item) => item.slug)).toEqual(["fine"]);
    expect(registry.errors.map((item) => item.slug)).toEqual(["huge"]);
  });
});
