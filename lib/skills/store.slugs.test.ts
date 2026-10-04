import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What an admin may ADD versus what an admin may DELETE.
 *
 * The two are deliberately not the same rule. The slug guards exist to stop a
 * bad key being introduced; applying them to a removal would make the very
 * entries this surface exists to clean up (a hand-seeded `kb:`, a
 * `Legacy-Thing:`, a `constructor:`) permanently undeletable, since the loader
 * only ever reports them as broken rows.
 */

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

const override: { load: ((filePath?: string) => SkillRegistry) | null } = { load: null };
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  return {
    ...actual,
    loadSkillRegistry: (filePath?: string) =>
      override.load ? override.load(filePath) : actual.loadSkillRegistry(filePath),
  };
});

import { writeSkills } from "./store";
import type { SkillEntry, SkillRegistry } from "./types";

const DEMO: SkillEntry = {
  slug: "demo",
  title: "Demo",
  source: { type: "git", url: "https://git.example/s.git", ref: "main", commit: "abc123" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

const SEEDED = [
  "skills:",
  "  demo:",
  "    title: Demo",
  "    source:",
  "      type: git",
  "      url: https://git.example/s.git",
  "      ref: main",
  "      commit: abc123",
  "    groups: [eng]",
  "    compat: {scripts: [], tools: []}",
  "",
].join("\n");

let root: string;
let filePath: string;

function writtenSkills(): Record<string, unknown> {
  const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
  const parsed = parseYaml(files["access/skills.yaml"]) as { skills: Record<string, unknown> };
  return parsed.skills;
}

function lastMessage(): string {
  const [, options] = commitPrivateAccessMock.mock.calls.at(-1) as [unknown, { message: string }];
  return options.message;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-store-slugs-"));
  filePath = path.join(root, "skills.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  override.load = null;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("slug guards on the write arms", () => {
  it("refuses an add of a reserved slug", async () => {
    const result = await writeSkills(
      { verb: "add", entry: { ...DEMO, slug: "kb" } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "reserved slug" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an add of a slug that is not a valid skill slug", async () => {
    const result = await writeSkills(
      { verb: "add", entry: { ...DEMO, slug: "Not A Slug" } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid slug" });
  });

  it.each(["constructor", "prototype"])("refuses an add of the prototype key %s", async (slug) => {
    const result = await writeSkills(
      { verb: "add", entry: { ...DEMO, slug } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid slug" });
  });

  it("refuses setGroups on a reserved slug even when the file carries one", async () => {
    writeFileSync(filePath, SEEDED.replace("  demo:", "  kb:"));

    const result = await writeSkills(
      { verb: "setGroups", slug: "kb", groups: ["eng"] },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "reserved slug" });
  });
});

describe("removal of keys the guards would reject", () => {
  it.each([
    ["a reserved slug", "kb"],
    ["a malformed slug", "Legacy-Thing"],
    ["a prototype key", "constructor"],
  ])("removes %s that only a hand-edit could have introduced", async (_label, slug) => {
    writeFileSync(filePath, SEEDED.replace("  demo:", `  ${slug}:`));

    const result = await writeSkills({ verb: "remove", slug }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(writtenSkills()).toEqual({});
    expect(lastMessage()).toBe(`chore(access): remove skill ${slug}`);
  });

  it("still refuses a remove of a reserved slug the file does not carry", async () => {
    const result = await writeSkills({ verb: "remove", slug: "kb" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "unknown skill" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});

describe("broken entries the loader rejects", () => {
  it("keeps an entry the loader rejects instead of silently dropping it", async () => {
    writeFileSync(filePath, "skills:\n  bad:\n    title: Bad\n");

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(Object.keys(writtenSkills())).toEqual(["bad", "demo"]);
  });

  it("refuses when the reparse reports a different set of rejected slugs", async () => {
    // The set-equality half of the round-trip check. Pinning the rejected set to
    // exactly the pre-existing one is what stops "preserve broken entries" being
    // turned into a way to smuggle a new broken entry past the loader.
    writeFileSync(filePath, "skills:\n  bad:\n    title: Bad\n");
    const actual = await vi.importActual<typeof import("./registry")>("./registry");
    override.load = (p?: string) =>
      p?.includes("skills-validate-")
        ? { entries: actual.loadSkillRegistry(p).entries, errors: [] }
        : actual.loadSkillRegistry(p);

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "skill configuration failed validation" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses to clobber a file it cannot parse", async () => {
    writeFileSync(filePath, "skills: [not: valid");

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "skills file is unreadable" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses to clobber a file carrying a sibling key the loader would reject", async () => {
    writeFileSync(filePath, "skills: {}\nplugins: {}\n");

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "skills file is unreadable" });
  });
});
