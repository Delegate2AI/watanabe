import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SKILL_BYTES,
  MAX_SKILL_FILES,
  slugifySkillName,
  validateSkillDir,
} from "./validate";

/** A SKILL.md with the given frontmatter lines and a one-line body. */
function skillMd(frontmatter: string[], body = "Body text."): string {
  return ["---", ...frontmatter, "---", "", body, ""].join("\n");
}

const MINIMAL = ["name: My Skill!", "description: Does a thing."];

describe("validateSkillDir", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-validate-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  it("accepts a minimal skill and normalizes the name to a slug", () => {
    write("SKILL.md", skillMd(MINIMAL));

    const result = validateSkillDir(root);

    expect(result).toEqual({
      ok: true,
      name: "My Skill!",
      slug: "my-skill",
      description: "Does a thing.",
      compat: { scripts: [], tools: [], urls: [], blockedScripts: [] },
    });
  });

  it("exports the spec's default caps", () => {
    expect(MAX_SKILL_BYTES).toBe(10_000_000);
    expect(MAX_SKILL_FILES).toBe(500);
  });

  it("rejects a directory that does not exist", () => {
    const result = validateSkillDir(path.join(root, "nope"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("not a directory");
  });

  it("rejects a path that is a file, not a directory", () => {
    write("SKILL.md", skillMd(MINIMAL));

    const result = validateSkillDir(path.join(root, "SKILL.md"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("not a directory");
  });

  it("rejects a directory with no SKILL.md", () => {
    write("README.md", "nothing here");

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("SKILL.md");
  });

  it("rejects a SKILL.md that is a directory instead of a file", () => {
    mkdirSync(path.join(root, "SKILL.md"));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("SKILL.md");
  });

  it("rejects a SKILL.md with no frontmatter delimiters", () => {
    write("SKILL.md", "# Just a heading\n\nno frontmatter\n");

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("frontmatter");
  });

  it("rejects binary garbage without throwing", () => {
    writeFileSync(path.join(root, "SKILL.md"), Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x00]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
  });

  it("rejects unparseable frontmatter yaml with a readable reason", () => {
    write("SKILL.md", skillMd(["name: [unclosed", "description: x"]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("frontmatter");
    expect(result.ok === false && result.reason.trim().startsWith("[")).toBe(false);
  });

  it("rejects frontmatter that parses to a string rather than a map", () => {
    write("SKILL.md", skillMd(["just a scalar"]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("map");
  });

  it("rejects frontmatter that parses to an array rather than a map", () => {
    write("SKILL.md", skillMd(["- one", "- two"]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("map");
  });

  it("rejects a missing name", () => {
    write("SKILL.md", skillMd(["description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("name");
  });

  it("rejects a null name", () => {
    write("SKILL.md", skillMd(["name:", "description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("name");
  });

  it("rejects a non-string name", () => {
    write("SKILL.md", skillMd(["name: 42", "description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("name");
  });

  it("rejects a missing description", () => {
    write("SKILL.md", skillMd(["name: My Skill"]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("description");
  });

  it("rejects an empty description", () => {
    write("SKILL.md", skillMd(["name: My Skill", 'description: "   "']));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("description");
  });

  it("rejects a name that slugifies to nothing", () => {
    write("SKILL.md", skillMd(["name: '!!!'", "description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("slug");
  });

  it("rejects a name that slugifies to a reserved slug", () => {
    write("SKILL.md", skillMd(["name: KB", "description: Does a thing."]));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("reserved");
  });

  it("rejects a directory over the byte cap", () => {
    write("SKILL.md", skillMd(MINIMAL));
    write("assets/big.bin", "x".repeat(2000));

    const result = validateSkillDir(root, { maxBytes: 500 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("too large");
  });

  it("rejects a directory over the file cap", () => {
    write("SKILL.md", skillMd(MINIMAL));
    for (const n of [1, 2, 3, 4]) write(`refs/f${n}.md`, "x");

    const result = validateSkillDir(root, { maxFiles: 3 });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("too many");
  });

  it("accepts a directory that sits exactly on the caps", () => {
    write("SKILL.md", skillMd(MINIMAL));

    const result = validateSkillDir(root, { maxFiles: 1, maxBytes: 10_000 });

    expect(result.ok).toBe(true);
  });
});

describe("slugifySkillName", () => {
  const cases: Array<[string, string]> = [
    ["My Skill!", "my-skill"],
    ["  --Weird__Name--  ", "weird-name"],
    ["9 Lives", "9-lives"],
    ["Café Ops", "cafe-ops"],
    ["already-fine", "already-fine"],
    ["!!!", ""],
    ["", ""],
    ["---", ""],
  ];

  for (const [input, expected] of cases) {
    it(`slugifies ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(slugifySkillName(input)).toBe(expected);
    });
  }

  it("caps the slug at the 32 character slug shape and never ends on a hyphen", () => {
    const slug = slugifySkillName(`${"a".repeat(31)} tail`);

    expect(slug).toBe("a".repeat(31));
    expect(slug.length).toBeLessThanOrEqual(32);
  });

  it("produces either an empty string or a slug matching the registry shape", () => {
    const inputs = [
      "My Skill!",
      "9 Lives",
      "---",
      "ééé",
      "A".repeat(80),
      "a-".repeat(20),
      "0123456789 0123456789 0123456789 0123456789",
    ];

    for (const input of inputs) {
      const slug = slugifySkillName(input);
      if (slug !== "") expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
    }
  });
});
