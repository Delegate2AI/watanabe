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
import { getConfig } from "@/lib/config";

const ALICE = "alice@example.com";
const ADMIN = "admin@example.com";
const BOT = getConfig().git.botEmail;

const savedEnv = { ...process.env };
let root: string;

type CommitOptions = { message: string; authorEmail: string; onBehalfOf?: { email: string } };

function skillsFile(): string {
  return path.join(root, "access", "skills.yaml");
}

function manifestPath(slug: string): string {
  return path.join(root, "store", slug, "SKILL.md");
}

function entryOf(slug: string) {
  return loadSkillRegistry(skillsFile()).entries.find((entry) => entry.slug === slug);
}

function commitOptions(): CommitOptions[] {
  return commitPrivateAccessMock.mock.calls.map((call) => call[1] as CommitOptions);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = () => settle();
  });
  return { promise, resolve };
}

function landsFiles(): (files: Record<string, string>) => Promise<{ ok: true }> {
  return async (files: Record<string, string>) => {
    for (const [relative, text] of Object.entries(files)) {
      writeFileSync(path.join(root, relative), text);
    }
    return { ok: true };
  };
}

async function create(overrides: Record<string, unknown> = {}) {
  return createAuthoredSkill({
    actorEmail: ALICE,
    title: "Release Notes",
    description: "How to write them",
    body: "Do the thing.",
    groups: ["engineering", "docs"],
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-authored-race-"));
  mkdirSync(path.join(root, "access"), { recursive: true });
  process.env.MEMORY_CHECKOUT_DIR = root;
  process.env.PORTAL_SKILLS_DIR = path.join(root, "store");
  process.env.BOOTSTRAP_ADMINS = ADMIN;
  delete process.env.ROLES_ENABLED;
  writeFileSync(
    path.join(root, "access", "groups.yaml"),
    [
      "groups:",
      "  engineering: [alice@example.com]",
      "  docs: [alice@example.com]",
      "  marketing: [boss@example.com]",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "access", "skill-authors.yaml"),
    ["authors:", "  alice@example.com:", "    - engineering", "    - docs", ""].join("\n"),
  );
  invalidateSkillAuthorsCache();
  invalidateSkillRegistryCache();
  invalidateAliasIndexCache();
  commitPrivateAccessMock.mockReset().mockImplementation(landsFiles());
});

afterEach(() => {
  process.env = { ...savedEnv };
  invalidateSkillAuthorsCache();
  invalidateSkillRegistryCache();
  invalidateAliasIndexCache();
  rmSync(root, { recursive: true, force: true });
});

describe("per-slug install lock", () => {
  it("lets exactly one of two concurrent creates of a slug land, and refuses the other", async () => {
    const gate = deferred();
    let first = true;
    commitPrivateAccessMock.mockImplementation(async (files: Record<string, string>) => {
      if (first) {
        first = false;
        await gate.promise;
      }
      return landsFiles()(files);
    });

    const both = Promise.all([create(), create()]);
    gate.resolve();
    const [left, right] = await both;

    const winners = [left, right].filter((result) => result.ok);
    const losers = [left, right].filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toEqual([{ ok: false, error: "slug already taken" }]);
    expect(
      commitOptions().filter((options) => options.message === "chore(access): add skill release-notes"),
    ).toHaveLength(1);
    expect(entryOf("release-notes")).toBeDefined();
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toContain("Do the thing.");
  });
});

describe("authored registry attribution", () => {
  it("commits a non-admin author's create as the human, on the bot's capability", async () => {
    expect((await create()).ok).toBe(true);

    const [options] = commitOptions();
    expect(options?.authorEmail).toBe(BOT);
    expect(options?.onBehalfOf).toEqual({ name: ALICE, email: ALICE });
  });
});

describe("atomic authored update", () => {
  it("moves the body and the groups in one registry commit", async () => {
    await create();
    commitPrivateAccessMock.mockClear();

    const result = await updateAuthoredSkill({
      actorEmail: ALICE,
      slug: "release-notes",
      body: "Do it better.",
      groups: ["engineering"],
    });

    expect(result).toEqual({ ok: true, slug: "release-notes" });
    expect(commitPrivateAccessMock).toHaveBeenCalledTimes(1);
    expect(entryOf("release-notes")?.groups).toEqual(["engineering"]);
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toContain("Do it better.");
  });

  it("never leaves the old groups holding the new body when the registry write fails", async () => {
    await create();
    const before = readFileSync(manifestPath("release-notes"), "utf8");
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "push rejected" });

    const result = await updateAuthoredSkill({
      actorEmail: ALICE,
      slug: "release-notes",
      body: "Do it better.",
      groups: ["engineering"],
    });

    expect(result.ok).toBe(false);
    expect(entryOf("release-notes")?.groups).toEqual(["docs", "engineering"]);
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toBe(before);
  });

  it("rolls the registry back when the new body cannot be landed", async () => {
    await create();
    const revBefore = (entryOf("release-notes")?.source as { rev: string }).rev;
    commitPrivateAccessMock.mockClear();

    const result = await updateAuthoredSkill(
      { actorEmail: ALICE, slug: "release-notes", body: "Do it better.", groups: ["engineering"] },
      {
        land: () => {
          throw new Error("disk full");
        },
      },
    );

    expect(result.ok).toBe(false);
    const entry = entryOf("release-notes");
    expect(entry?.groups).toEqual(["docs", "engineering"]);
    expect((entry?.source as { rev: string }).rev).toBe(revBefore);
    expect(readFileSync(manifestPath("release-notes"), "utf8")).toContain("Do the thing.");
    expect(existsSync(path.join(root, "store", "release-notes"))).toBe(true);
  });
});
