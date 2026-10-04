import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAliasIndexCache } from "@/lib/authority/aliases";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { createAuthoredSkill } from "./authored";
import { readAuthoredSkill } from "./authored-read";
import { invalidateSkillAuthorsCache } from "./authors";
import { invalidateSkillRegistryCache } from "./registry";

const ALICE = "alice@example.com";
const MALLORY = "mallory@example.com";
const ADMIN = "admin@example.com";
const BODY = "Do the thing.\n\n## Then\n\nDo the other thing.";

const savedEnv = { ...process.env };
let root: string;

async function create() {
  return createAuthoredSkill({
    actorEmail: ALICE,
    title: "Release Notes",
    description: "How to write them",
    body: BODY,
    groups: ["engineering"],
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-authored-read-"));
  mkdirSync(path.join(root, "access"), { recursive: true });
  process.env.MEMORY_CHECKOUT_DIR = root;
  process.env.PORTAL_SKILLS_DIR = path.join(root, "store");
  process.env.BOOTSTRAP_ADMINS = ADMIN;
  delete process.env.ROLES_ENABLED;
  writeFileSync(
    path.join(root, "access", "groups.yaml"),
    ["groups:", "  engineering: [alice@example.com]", "  marketing: [boss@example.com]", ""].join("\n"),
  );
  writeFileSync(
    path.join(root, "access", "skill-authors.yaml"),
    [
      "authors:",
      "  alice@example.com:",
      "    - engineering",
      "  mallory@example.com:",
      "    - engineering",
      "",
    ].join("\n"),
  );
  invalidateSkillAuthorsCache();
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

describe("readAuthoredSkill", () => {
  it("returns the stored body and metadata to the recorded author", async () => {
    await create();

    const result = await readAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill).toMatchObject({
      slug: "release-notes",
      title: "Release Notes",
      description: "How to write them",
      groups: ["engineering"],
      body: BODY,
    });
    expect(result.skill.rev).toMatch(/^[0-9a-f]{12}$/);
  });

  it("refuses a granted author who is not the recorded author", async () => {
    await create();

    const result = await readAuthoredSkill({ actorEmail: MALLORY, slug: "release-notes" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an author whose grant no longer covers the skill's groups", async () => {
    await create();
    writeFileSync(path.join(root, "access", "skill-authors.yaml"), "authors: {}\n");
    invalidateSkillAuthorsCache();

    const result = await readAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
  });

  it("lets an admin read a skill they did not write", async () => {
    await create();

    const result = await readAuthoredSkill({ actorEmail: ADMIN, slug: "release-notes" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.body).toBe(BODY);
  });

  it("refuses a slug that is not an authored skill", async () => {
    const result = await readAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result).toEqual({ ok: false, error: "not an authored skill" });
  });
});
