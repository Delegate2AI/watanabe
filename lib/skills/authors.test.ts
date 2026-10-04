import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorGroups, canAuthorSkills, invalidateSkillAuthorsCache, loadSkillAuthors } from "./authors";

const savedEnv = { ...process.env };
let root: string;
let filePath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skill-authors-"));
  mkdirSync(path.join(root, "access"), { recursive: true });
  filePath = path.join(root, "access", "skill-authors.yaml");
  process.env.MEMORY_CHECKOUT_DIR = root;
  invalidateSkillAuthorsCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  invalidateSkillAuthorsCache();
  rmSync(root, { recursive: true, force: true });
});

function writeAuthors(lines: string[]): void {
  writeFileSync(filePath, lines.join("\n") + "\n");
}

function writeGroups(lines: string[]): void {
  writeFileSync(path.join(root, "access", "groups.yaml"), lines.join("\n") + "\n");
}

function writeAliases(lines: string[]): void {
  writeFileSync(path.join(root, "access", "aliases.yaml"), lines.join("\n") + "\n");
}

describe("canAuthorSkills", () => {
  it("grants when the email is listed with the group", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);

    expect(canAuthorSkills("alice@example.com", "engineering", filePath)).toBe(true);
  });

  it("denies when the email is listed but not for that group", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);

    expect(canAuthorSkills("alice@example.com", "marketing", filePath)).toBe(false);
  });

  it("denies an email with no entry in the file", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);

    expect(canAuthorSkills("stranger@example.com", "engineering", filePath)).toBe(false);
  });

  it("loads empty grants for a missing file without throwing", () => {
    const missing = path.join(root, "access", "missing.yaml");

    expect(() => loadSkillAuthors(missing)).not.toThrow();
    expect(loadSkillAuthors(missing)).toEqual({ authors: {}, errors: [] });
    expect(canAuthorSkills("alice@example.com", "engineering", missing)).toBe(false);
  });

  it("treats all-hands in an author's group list as a parse error for that entry only", () => {
    writeAuthors([
      "authors:",
      "  alice@example.com:",
      "    - all-hands",
      "  bob@example.com:",
      "    - engineering",
    ]);

    const result = loadSkillAuthors(filePath);

    expect(result.authors.alice).toBeUndefined();
    expect(result.authors["alice@example.com"]).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(canAuthorSkills("alice@example.com", "engineering", filePath)).toBe(false);
    expect(canAuthorSkills("bob@example.com", "engineering", filePath)).toBe(true);
  });

  it("grants an admin every group without an entry in the file", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);
    process.env.BOOTSTRAP_ADMINS = "boss@example.com";

    expect(canAuthorSkills("boss@example.com", "engineering", filePath)).toBe(true);
    expect(canAuthorSkills("boss@example.com", "marketing", filePath)).toBe(true);
  });

  it("resolves an aliased email to its canonical entry", () => {
    writeAliases(["aliases:", "  alice@example.com:", "    - alice.personal@example.com"]);
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);

    expect(canAuthorSkills("alice.personal@example.com", "engineering", filePath)).toBe(true);
  });

  it("fails closed when two keys normalize to the same email, dropping both", () => {
    writeAuthors([
      "authors:",
      "  Alice@example.com:",
      "    - engineering",
      "  alice@example.com:",
      "    - marketing",
    ]);

    const result = loadSkillAuthors(filePath);

    expect(result.authors["alice@example.com"]).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes("Alice@example.com") && error.includes("alice@example.com"))).toBe(true);
    expect(canAuthorSkills("alice@example.com", "engineering", filePath)).toBe(false);
    expect(canAuthorSkills("alice@example.com", "marketing", filePath)).toBe(false);
  });

  it("treats a blank group name as a per-entry error, granting nothing from that entry", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - \"\"", "    - engineering"]);

    const result = loadSkillAuthors(filePath);

    expect(result.authors["alice@example.com"]).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(canAuthorSkills("alice@example.com", "engineering", filePath)).toBe(false);
    expect(canAuthorSkills("alice@example.com", "", filePath)).toBe(false);
  });
});

describe("authorGroups", () => {
  it("is empty for someone with no author entry", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);

    expect(authorGroups("stranger@example.com", filePath)).toEqual([]);
  });

  it("returns the groups an author is listed under", () => {
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering", "    - marketing"]);

    expect(authorGroups("alice@example.com", filePath)).toEqual(["engineering", "marketing"]);
  });

  it("returns the full group list from lib/authority/groups for an admin", () => {
    writeGroups([
      "groups:",
      "  all-hands: [alice@example.com]",
      "  engineering: [alice@example.com]",
      "  admins: [boss@example.com]",
    ]);
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);
    process.env.BOOTSTRAP_ADMINS = "boss@example.com";

    expect(authorGroups("boss@example.com", filePath)).toEqual(["admins", "all-hands", "engineering"]);
  });

  it("adds the implicit all-hands group for an admin even when groups.yaml omits it", () => {
    writeGroups(["groups:", "  engineering: [alice@example.com]", "  admins: [boss@example.com]"]);
    writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);
    process.env.BOOTSTRAP_ADMINS = "boss@example.com";

    expect(authorGroups("boss@example.com", filePath)).toEqual(["admins", "all-hands", "engineering"]);
  });
});
