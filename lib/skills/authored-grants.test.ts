import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAliasIndexCache } from "@/lib/authority/aliases";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { createAuthoredSkill, deleteAuthoredSkill, updateAuthoredSkill } from "./authored";
import { invalidateSkillAuthorsCache } from "./authors";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";

const ALICE = "alice@example.com";
const ADMIN = "admin@example.com";

const savedEnv = { ...process.env };
let root: string;

function entryOf(slug: string) {
  return loadSkillRegistry(path.join(root, "access", "skills.yaml")).entries.find(
    (entry) => entry.slug === slug,
  );
}

function writeAuthors(lines: string[]): void {
  writeFileSync(path.join(root, "access", "skill-authors.yaml"), lines.join("\n") + "\n");
  invalidateSkillAuthorsCache();
}

async function create() {
  return createAuthoredSkill({
    actorEmail: ALICE,
    title: "Release Notes",
    description: "How to write them",
    body: "Do the thing.",
    groups: ["engineering"],
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-authored-grants-"));
  mkdirSync(path.join(root, "access"), { recursive: true });
  process.env.MEMORY_CHECKOUT_DIR = root;
  process.env.PORTAL_SKILLS_DIR = path.join(root, "store");
  process.env.BOOTSTRAP_ADMINS = ADMIN;
  delete process.env.ROLES_ENABLED;
  writeFileSync(
    path.join(root, "access", "groups.yaml"),
    ["groups:", "  engineering: [alice@example.com]", "  marketing: [boss@example.com]", ""].join("\n"),
  );
  writeAuthors(["authors:", "  alice@example.com:", "    - engineering"]);
  invalidateSkillRegistryCache();
  invalidateAliasIndexCache();
  commitPrivateAccessMock.mockReset().mockImplementation(async (files: Record<string, string>) => {
    for (const [rel, text] of Object.entries(files)) {
      writeFileSync(path.join(root, rel), text);
    }
    return { ok: true };
  });
});

afterEach(() => {
  process.env = { ...savedEnv };
  invalidateSkillAuthorsCache();
  invalidateSkillRegistryCache();
  invalidateAliasIndexCache();
  rmSync(root, { recursive: true, force: true });
});

describe("current-grant requirement on update and delete", () => {
  it("refuses an update from an author whose grant was revoked", async () => {
    await create();
    writeAuthors(["authors: {}"]);

    const result = await updateAuthoredSkill({ actorEmail: ALICE, slug: "release-notes", body: "New." });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    const manifest = readFileSync(path.join(root, "store", "release-notes", "SKILL.md"), "utf8");
    expect(manifest).toContain("Do the thing.");
  });

  it("refuses a delete from an author whose grant was revoked", async () => {
    await create();
    writeAuthors(["authors: {}"]);

    const result = await deleteAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(entryOf("release-notes")).toBeDefined();
    expect(existsSync(path.join(root, "store", "release-notes"))).toBe(true);
  });

  it("refuses an update from an author whose grant no longer covers the skill's groups", async () => {
    await create();
    const widened = await updateAuthoredSkill({
      actorEmail: ADMIN,
      slug: "release-notes",
      groups: ["engineering", "marketing"],
    });
    expect(widened).toEqual({ ok: true, slug: "release-notes" });

    const result = await updateAuthoredSkill({ actorEmail: ALICE, slug: "release-notes", body: "New." });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("still lets an admin update and delete after the author's grant is revoked", async () => {
    await create();
    writeAuthors(["authors: {}"]);

    const updated = await updateAuthoredSkill({ actorEmail: ADMIN, slug: "release-notes", body: "Kept." });
    expect(updated).toEqual({ ok: true, slug: "release-notes" });

    const deleted = await deleteAuthoredSkill({ actorEmail: ADMIN, slug: "release-notes" });
    expect(deleted).toEqual({ ok: true, slug: "release-notes" });
    expect(entryOf("release-notes")).toBeUndefined();
  });
});

describe("create rollback failure surfacing", () => {
  it("names the possibly remaining reservation when the rollback write also fails", async () => {
    let calls = 0;
    commitPrivateAccessMock.mockImplementation(async (files: Record<string, string>) => {
      calls += 1;
      if (calls === 2) return { ok: false, error: "push failed" };
      for (const [rel, text] of Object.entries(files)) {
        writeFileSync(path.join(root, rel), text);
      }
      return { ok: true };
    });

    const result = await createAuthoredSkill(
      {
        actorEmail: ALICE,
        title: "Doomed Skill",
        description: "Never lands",
        body: "Body.",
        groups: ["engineering"],
      },
      {
        land: () => {
          throw new Error("disk full");
        },
      },
    );

    expect(result.ok).toBe(false);
    const error = (result as { ok: false; error: string }).error;
    expect(error).toContain("disk full");
    expect(error).toMatch(/reservation may remain/);
  });
});
