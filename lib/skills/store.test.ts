import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

// Partial mock, same shape as lib/connectors/store.test.ts: the real loader
// still runs, because the reparse round-trip is the point of these tests. The
// invalidator is observed but calls through. Everything the factory closes over
// is read lazily, since vitest hoists vi.mock above these declarations.
const invalidateSpy = vi.fn();
const override: { load: ((filePath?: string) => SkillRegistry) | null } = { load: null };
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  return {
    ...actual,
    loadSkillRegistry: (filePath?: string) =>
      override.load ? override.load(filePath) : actual.loadSkillRegistry(filePath),
    invalidateSkillRegistryCache: () => {
      invalidateSpy();
      actual.invalidateSkillRegistryCache();
    },
  };
});

import { writeSkills } from "./store";
import type { SkillEntry, SkillRegistry, SkillSource } from "./types";

const DEMO: SkillEntry = {
  slug: "demo",
  title: "Demo",
  source: { type: "git", url: "https://git.example/s.git", ref: "main", commit: "abc123" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

/** The same entry as it sits in access/skills.yaml, ready to seed a temp file. */
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

function committed(): {
  files: Record<string, string>;
  options: { message: string; authorName: string; authorEmail: string };
} {
  const [files, options] = commitPrivateAccessMock.mock.calls.at(-1) as [
    Record<string, string>,
    { message: string; authorName: string; authorEmail: string },
  ];
  return { files, options };
}

function writtenSkills(): Record<string, unknown> {
  const parsed = parseYaml(committed().files["access/skills.yaml"]) as {
    skills: Record<string, unknown>;
  };
  return parsed.skills;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-store-"));
  filePath = path.join(root, "skills.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  invalidateSpy.mockReset();
  override.load = null;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("writeSkills", () => {
  it("refuses a caller without manageAccess before reading or committing", async () => {
    canMock.mockReturnValue(false);

    const result = await writeSkills({ verb: "add", entry: DEMO }, "nobody@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("commits an add as access/skills.yaml, authored by the actor", async () => {
    const result = await writeSkills({ verb: "add", entry: DEMO }, "Admin@Example.com", { filePath });

    expect(result).toEqual({ ok: true });
    const { files, options } = committed();
    expect(Object.keys(files)).toEqual(["access/skills.yaml"]);
    expect(writtenSkills()).toEqual({
      demo: { title: DEMO.title, source: DEMO.source, groups: DEMO.groups, compat: DEMO.compat },
    });
    expect(options.message).toBe("chore(access): add skill demo");
    expect(options.authorName).toBe("admin@example.com");
    expect(options.authorEmail).toBe("admin@example.com");
  });

  it("refuses an add of a slug the file already carries", async () => {
    writeFileSync(filePath, SEEDED);

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "duplicate slug" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses an entry that fails the per-entry schema", async () => {
    const broken = { slug: "broken", title: "Broken", groups: ["eng"] } as unknown as SkillEntry;

    const result = await writeSkills({ verb: "add", entry: broken }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a remove of a slug the file does not carry", async () => {
    const result = await writeSkills({ verb: "remove", slug: "demo" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "unknown skill" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("commits a remove of a registered slug", async () => {
    writeFileSync(filePath, SEEDED);

    const result = await writeSkills({ verb: "remove", slug: "demo" }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(writtenSkills()).toEqual({});
    expect(committed().options.message).toBe("chore(access): remove skill demo");
  });

  it("sets the groups of an existing entry and leaves the rest alone", async () => {
    writeFileSync(filePath, SEEDED);

    const result = await writeSkills(
      { verb: "setGroups", slug: "demo", groups: ["eng", "ops"] },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(writtenSkills()).toEqual({
      demo: { title: DEMO.title, source: DEMO.source, groups: ["eng", "ops"], compat: DEMO.compat },
    });
    expect(committed().options.message).toBe("chore(access): setGroups skill demo");
  });

  it("refuses setGroups for a slug the file does not carry", async () => {
    const result = await writeSkills(
      { verb: "setGroups", slug: "demo", groups: ["eng"] },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "unknown skill" });
  });

  it("repins source and compat on update and keeps title and groups", async () => {
    writeFileSync(filePath, SEEDED);
    const source = {
      type: "git",
      url: "https://git.example/s.git",
      ref: "main",
      commit: "deadbee",
    } as const;

    const result = await writeSkills(
      { verb: "update", slug: "demo", source, compat: { scripts: ["run.sh"], tools: ["Write"] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(writtenSkills()).toEqual({
      demo: {
        title: DEMO.title,
        source,
        groups: DEMO.groups,
        compat: { scripts: ["run.sh"], tools: ["Write"] },
      },
    });
  });

  it("accepts an update whose optional subdir was spread in as undefined", async () => {
    writeFileSync(filePath, SEEDED);
    // The shape a route that rebuilds a source with a plain object spread
    // produces, rather than with the conditional-spread idiom the install path
    // uses. Left in place, zod keeps the key, the serializer writes
    // `subdir: null`, and the loader rejects an entry this writer just built,
    // so the refusal names the wrong cause.
    const source: SkillSource = {
      type: "git",
      url: "https://git.example/s.git",
      ref: "main",
      subdir: undefined,
      commit: "deadbee",
    };

    const result = await writeSkills(
      { verb: "update", slug: "demo", source, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(committed().files["access/skills.yaml"]).not.toContain("subdir");
    expect(writtenSkills()).toEqual({
      demo: {
        title: DEMO.title,
        source: { type: "git", url: "https://git.example/s.git", ref: "main", commit: "deadbee" },
        groups: DEMO.groups,
        compat: { scripts: [], tools: [] },
      },
    });
  });

  it("still refuses an entry whose required field was spread in as undefined", async () => {
    // Stripping undefined keys must not widen what the schema accepts: a
    // required field is still missing, and the error still names the entry.
    const broken = { ...DEMO, title: undefined } as unknown as SkillEntry;

    const result = await writeSkills({ verb: "add", entry: broken }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
  });

  it("serializes and reparses the whole file through the real loader before committing", async () => {
    writeFileSync(filePath, SEEDED.replace("  demo:", "  wiki:"));

    await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(Object.keys(writtenSkills())).toEqual(["demo", "wiki"]);
  });

  it("refuses when the reparsed file does not match what the change intended", async () => {
    const actual = await vi.importActual<typeof import("./registry")>("./registry");
    override.load = (p?: string) =>
      p?.includes("skills-validate-") ? { entries: [], errors: [] } : actual.loadSkillRegistry(p);

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "skill configuration failed validation" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates the registry cache after a successful write", async () => {
    await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("reports a refused commit and does not claim success", async () => {
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "private access checkout unavailable" });

    const result = await writeSkills({ verb: "add", entry: DEMO }, "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "private access checkout unavailable" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
