import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAliasIndexCache } from "@/lib/authority/aliases";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

const uninstallSkillMock = vi.hoisted(() => vi.fn());
vi.mock("./install-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./install-store")>();
  uninstallSkillMock.mockImplementation((slug: string) => actual.uninstallSkill(slug));
  return { ...actual, uninstallSkill: (slug: string) => uninstallSkillMock(slug) };
});

import { createAuthoredSkill, deleteAuthoredSkill } from "./authored";
import { invalidateSkillAuthorsCache } from "./authors";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";

const ALICE = "alice@example.com";
const MALLORY = "mallory@example.com";
const ADMIN = "admin@example.com";

const savedEnv = { ...process.env };
let root: string;

function skillsFile(): string {
  return path.join(root, "access", "skills.yaml");
}

function storeDir(slug: string): string {
  return path.join(root, "store", slug);
}

function manifestPath(slug: string): string {
  return path.join(storeDir(slug), "SKILL.md");
}

function entryOf(slug: string) {
  return loadSkillRegistry(skillsFile()).entries.find((entry) => entry.slug === slug);
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
  root = mkdtempSync(path.join(os.tmpdir(), "skills-authored-delete-"));
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
    ["authors:", "  alice@example.com:", "    - engineering", "  mallory@example.com:", "    - engineering", ""].join(
      "\n",
    ),
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

describe("deleteAuthoredSkill", () => {
  it("removes both the registry entry and the store directory for the author", async () => {
    await create();

    const result = await deleteAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    expect(entryOf("release-notes")).toBeUndefined();
    expect(existsSync(storeDir("release-notes"))).toBe(false);
  });

  it("refuses a granted author who is not the recorded author", async () => {
    await create();

    const result = await deleteAuthoredSkill({ actorEmail: MALLORY, slug: "release-notes" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(entryOf("release-notes")).toBeDefined();
    expect(existsSync(manifestPath("release-notes"))).toBe(true);
  });

  it("reports a failure and leaves the slug blocked when the store directory cannot be deleted", async () => {
    await create();
    uninstallSkillMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const result = await deleteAuthoredSkill({ actorEmail: ALICE, slug: "release-notes" });

    expect(result.ok).toBe(false);
    expect(entryOf("release-notes")).toBeUndefined();
    expect(existsSync(storeDir("release-notes"))).toBe(true);
  });
});
