import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAliasIndexCache } from "@/lib/authority/aliases";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { createAuthoredSkill, updateAuthoredSkill } from "./authored";
import { invalidateSkillAuthorsCache } from "./authors";
import { invalidateSkillRegistryCache, loadSkillRegistry } from "./registry";
import { validateSkillDir } from "./validate";

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

function seedAccess(): void {
  writeFileSync(
    path.join(root, "access", "groups.yaml"),
    ["groups:", "  engineering: [alice@example.com]", "  marketing: [boss@example.com]", ""].join("\n"),
  );
  writeFileSync(
    path.join(root, "access", "skill-authors.yaml"),
    ["authors:", "  alice@example.com:", "    - engineering", "  mallory@example.com:", "    - engineering", ""].join("\n"),
  );
}

async function create(overrides: Record<string, unknown> = {}) {
  return createAuthoredSkill({
    actorEmail: ALICE,
    title: "Release Notes",
    description: "How to write them",
    body: "Do the thing.",
    groups: ["engineering"],
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-authored-"));
  mkdirSync(path.join(root, "access"), { recursive: true });
  process.env.MEMORY_CHECKOUT_DIR = root;
  process.env.PORTAL_SKILLS_DIR = path.join(root, "store");
  process.env.BOOTSTRAP_ADMINS = ADMIN;
  delete process.env.ROLES_ENABLED;
  seedAccess();
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

describe("createAuthoredSkill", () => {
  it("lands a valid SKILL.md in the store and records the actor as author with a content rev", async () => {
    const result = await create();

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    const manifest = readFileSync(manifestPath("release-notes"), "utf8");
    expect(manifest).toContain("Do the thing.");
    expect(validateSkillDir(storeDir("release-notes"))).toMatchObject({
      ok: true,
      name: "Release Notes",
      slug: "release-notes",
      description: "How to write them",
    });
    const expectedRev = createHash("sha256").update(manifest, "utf8").digest("hex").slice(0, 12);
    const entry = entryOf("release-notes");
    expect(entry?.source).toEqual({ type: "authored", author: ALICE, rev: expectedRev });
    expect(entry?.groups).toEqual(["engineering"]);
    expect(entry?.title).toBe("Release Notes");
  });

  it("refuses a group outside the actor's grant and writes nothing", async () => {
    const result = await create({ groups: ["marketing"] });

    expect(result).toEqual({ ok: false, error: "invalid groups" });
    expect(existsSync(storeDir("release-notes"))).toBe(false);
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an actor with no author grant at all", async () => {
    const result = await create({ actorEmail: "stranger@example.com", groups: [] });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a colliding slug already taken by a registry entry or a registry error", async () => {
    writeFileSync(
      skillsFile(),
      [
        "skills:",
        "  taken:",
        "    title: Taken",
        "    source: {type: git, url: u, ref: main, commit: abc}",
        "    groups: [engineering]",
        "    compat: {scripts: [], tools: []}",
        "  broken:",
        "    title: Broken",
        "",
      ].join("\n"),
    );

    for (const title of ["Taken", "Broken"]) {
      const result = await create({ title });
      expect(result.ok).toBe(false);
    }
    expect(existsSync(storeDir("taken"))).toBe(false);
    expect(existsSync(storeDir("broken"))).toBe(false);
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("recovers from a leftover store directory with no matching registry entry or error", async () => {
    mkdirSync(storeDir("release-notes"), { recursive: true });
    writeFileSync(path.join(storeDir("release-notes"), "stale.txt"), "leftover");

    const result = await create();

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    expect(existsSync(path.join(storeDir("release-notes"), "stale.txt"))).toBe(false);
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toContain("Do the thing.");
  });

  it("rolls the registry reservation back when landing fails", async () => {
    const failing = await createAuthoredSkill(
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

    expect(failing.ok).toBe(false);
    expect(entryOf("doomed-skill")).toBeUndefined();
    expect(existsSync(storeDir("doomed-skill"))).toBe(false);
    const verbs = commitPrivateAccessMock.mock.calls.map(
      (call) => (call[1] as { message: string }).message,
    );
    expect(verbs).toContain("chore(access): add skill doomed-skill");
    expect(verbs).toContain("chore(access): remove skill doomed-skill");
  });
});

describe("updateAuthoredSkill", () => {
  it("refuses a granted author who is not the recorded author", async () => {
    await create();
    const before = readFileSync(manifestPath("release-notes"), "utf8");

    const result = await updateAuthoredSkill({ actorEmail: MALLORY, slug: "release-notes", body: "Hijacked." });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toBe(before);
  });

  it("lets the author change the body and moves the rev to the new content", async () => {
    await create();
    const firstRev = (entryOf("release-notes")?.source as { rev: string }).rev;

    const result = await updateAuthoredSkill({ actorEmail: ALICE, slug: "release-notes", body: "Do it better." });

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    const manifest = readFileSync(manifestPath("release-notes"), "utf8");
    expect(manifest).toContain("Do it better.");
    const source = entryOf("release-notes")?.source as { author: string; rev: string };
    expect(source.author).toBe(ALICE);
    expect(source.rev).toBe(createHash("sha256").update(manifest, "utf8").digest("hex").slice(0, 12));
    expect(source.rev).not.toBe(firstRev);
  });

  it("refuses widening groups past the author's grant", async () => {
    await create();

    const result = await updateAuthoredSkill({
      actorEmail: ALICE,
      slug: "release-notes",
      groups: ["engineering", "marketing"],
    });

    expect(result).toEqual({ ok: false, error: "invalid groups" });
    expect(entryOf("release-notes")?.groups).toEqual(["engineering"]);
  });

  it("lets an admin update another author's skill with unbounded groups, keeping the author", async () => {
    await create();

    const result = await updateAuthoredSkill({
      actorEmail: ADMIN,
      slug: "release-notes",
      groups: ["marketing"],
      description: "Now marketing's",
    });

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    const entry = entryOf("release-notes");
    expect(entry?.groups).toEqual(["marketing"]);
    expect((entry?.source as { author: string }).author).toBe(ALICE);
  });

  it("refuses a title that would change the slug", async () => {
    await create();

    const result = await updateAuthoredSkill({
      actorEmail: ALICE,
      slug: "release-notes",
      title: "Completely Different Name",
    });

    expect(result.ok).toBe(false);
    expect(entryOf("release-notes")?.title).toBe("Release Notes");
    expect(existsSync(storeDir("completely-different-name"))).toBe(false);
  });

  it("refuses a slug that is not an authored skill", async () => {
    const result = await updateAuthoredSkill({ actorEmail: ALICE, slug: "release-notes", body: "x" });

    expect(result.ok).toBe(false);
  });
});
