import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_COMPAT_ITEMS, MAX_COMPAT_ITEM_CHARS } from "./compat";
import {
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  validateSkillDir,
} from "./validate";

/**
 * Caps on what leaves the validator. The folder-level caps are covered in
 * validate.test.ts; these pin the per-field and per-report-list ones, which are
 * what keep a hostile skill from parking a 9MB description in every session's
 * context or a 50,000 URL list in the admin's trust badge.
 */
function skillMd(frontmatter: string[], body = "Body."): string {
  return ["---", ...frontmatter, "---", "", body, ""].join("\n");
}

function expectOk(result: ReturnType<typeof validateSkillDir>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result;
}

describe("validateSkillDir field caps", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-caps-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  it("exports the Agent Skills standard's field caps", () => {
    expect(MAX_SKILL_NAME_CHARS).toBe(64);
    expect(MAX_SKILL_DESCRIPTION_CHARS).toBe(1024);
    expect(MAX_COMPAT_ITEMS).toBe(50);
    expect(MAX_COMPAT_ITEM_CHARS).toBe(200);
  });

  it("rejects a name over the character cap", () => {
    const name = "a".repeat(MAX_SKILL_NAME_CHARS + 1);
    write("SKILL.md", skillMd([`name: ${name}`, "description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("`name` is too long");
  });

  it("accepts a name exactly on the character cap", () => {
    const name = "a".repeat(MAX_SKILL_NAME_CHARS);
    write("SKILL.md", skillMd([`name: ${name}`, "description: Does a thing."]));

    const result = expectOk(validateSkillDir(root));

    expect(result.name).toHaveLength(MAX_SKILL_NAME_CHARS);
    expect(result.slug).toBe("a".repeat(32));
  });

  it("rejects a description over the character cap", () => {
    const description = "d".repeat(MAX_SKILL_DESCRIPTION_CHARS + 1);
    write("SKILL.md", skillMd(["name: My Skill", `description: ${description}`]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("`description` is too long");
  });

  it("accepts a description exactly on the character cap", () => {
    const description = "d".repeat(MAX_SKILL_DESCRIPTION_CHARS);
    write("SKILL.md", skillMd(["name: My Skill", `description: ${description}`]));

    const result = expectOk(validateSkillDir(root));

    expect(result.description).toHaveLength(MAX_SKILL_DESCRIPTION_CHARS);
  });

  it("rejects a description that is huge but still inside the byte cap", () => {
    write("SKILL.md", skillMd(["name: My Skill", `description: ${"d".repeat(200_000)}`]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("`description` is too long");
  });
});

describe("compat report caps", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-caps-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  const MINIMAL = ["name: My Skill", "description: Does a thing."];

  it("truncates a long script list and says how many were dropped", () => {
    write("SKILL.md", skillMd(MINIMAL));
    for (let i = 0; i < MAX_COMPAT_ITEMS + 10; i += 1) {
      write(`scripts/s${String(i).padStart(3, "0")}.sh`, "echo hi\n");
    }

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.scripts).toHaveLength(MAX_COMPAT_ITEMS + 1);
    expect(result.compat.scripts[0]).toBe("scripts/s000.sh");
    expect(result.compat.scripts.at(-1)).toBe("+10 more");
  });

  it("truncates a long URL list and says how many were dropped", () => {
    const urls = Array.from(
      { length: MAX_COMPAT_ITEMS + 25 },
      (_, i) => `https://example.com/${String(i).padStart(3, "0")}`,
    );
    write("SKILL.md", skillMd(MINIMAL, urls.join("\n")));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.urls).toHaveLength(MAX_COMPAT_ITEMS + 1);
    expect(result.compat.urls[0]).toBe("https://example.com/000");
    expect(result.compat.urls.at(-1)).toBe("+25 more");
  });

  it("clips a single oversized allowed-tools entry instead of reporting it whole", () => {
    write("SKILL.md", skillMd([...MINIMAL, `allowed-tools: [${"X".repeat(5000)}]`]));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.tools).toHaveLength(1);
    const [tool] = result.compat.tools;
    expect(tool).toBe(`${"X".repeat(MAX_COMPAT_ITEM_CHARS)}... (truncated)`);
  });

  it("clips a single oversized URL instead of reporting it whole", () => {
    write("SKILL.md", skillMd(MINIMAL, `https://example.com/${"q".repeat(5000)}`));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.urls[0]).toHaveLength(MAX_COMPAT_ITEM_CHARS + "... (truncated)".length);
  });

  it("leaves a list that fits under the cap untouched, with no more marker", () => {
    write("SKILL.md", skillMd(MINIMAL, "https://example.com/a and https://example.com/b"));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
  });
});
