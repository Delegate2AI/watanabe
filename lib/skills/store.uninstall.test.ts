import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Uninstall is three things at once (spec 34): the store directory goes, the
 * registry entry goes, and every materialized plugin directory is dropped so no
 * stale tree can still be handed to a session. The real registry loader and the
 * real materializer run here; only the capability check and the git commit are
 * stubbed.
 */

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { skillsMaterializedDir, skillsStoreDir } from "./config";
import { materializeSkillsPlugin } from "./materialize";
import { invalidateSkillRegistryCache } from "./registry";
import { removeInstalledSkill } from "./store";

let root: string;
let filePath: string;

function seedRegistry(slug: string): void {
  writeFileSync(
    filePath,
    [
      "skills:",
      `  ${slug}:`,
      "    title: Demo",
      "    source:",
      "      type: git",
      "      url: https://git.example/s.git",
      "      ref: main",
      "      commit: abc123",
      "    groups: [eng]",
      "    compat: {scripts: [], tools: []}",
      "",
    ].join("\n"),
  );
  invalidateSkillRegistryCache();
}

function installStoreDir(slug: string): string {
  const dir = path.join(skillsStoreDir(), slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: d\n---\n\nBody.\n`);
  return dir;
}

/** Apply what the mocked commit would have written, so a later read sees it. */
function applyCommit(): void {
  const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
  writeFileSync(filePath, files["access/skills.yaml"]);
  invalidateSkillRegistryCache();
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-uninstall-"));
  filePath = path.join(root, "skills.yaml");
  process.env.PORTAL_SKILLS_DIR = path.join(root, "store");
  process.env.SKILLS_ENABLED = "1";
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
  invalidateSkillRegistryCache();
});

afterEach(() => {
  delete process.env.PORTAL_SKILLS_DIR;
  delete process.env.SKILLS_ENABLED;
  invalidateSkillRegistryCache();
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("removeInstalledSkill", () => {
  it("removes the store directory, the registry entry, and every materialization", async () => {
    seedRegistry("demo");
    const dir = installStoreDir("demo");
    const before = materializeSkillsPlugin(["eng"], { registryPath: filePath });
    expect(before?.slugs).toEqual(["demo"]);
    expect(existsSync(before?.pluginPath ?? "")).toBe(true);

    const result = await removeInstalledSkill("demo", "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    expect(existsSync(dir)).toBe(false);
    // The root survives by design: invalidation removes only its key-shaped
    // children, so a mistyped or request-derived path cannot take a data
    // directory with it.
    expect(readdirSync(skillsMaterializedDir())).toEqual([]);
    // THIS is the line that proves a stale tree cannot be served: the directory
    // a session was handed a moment ago is physically gone. The test below
    // gets its null from the emptied registry instead, so it would still pass
    // with invalidation removed. Do not drop this assertion.
    expect(existsSync(before?.pluginPath ?? "")).toBe(false);
  });

  it("serves nothing for that clearance once the committed registry lands", async () => {
    // Registry-level check only. The unreachability of the OLD tree is pinned
    // by the assertion in the test above, not here.
    seedRegistry("demo");
    installStoreDir("demo");
    materializeSkillsPlugin(["eng"], { registryPath: filePath });

    await removeInstalledSkill("demo", "admin@example.com", { filePath });
    applyCommit();

    expect(materializeSkillsPlugin(["eng"], { registryPath: filePath })).toBeNull();
  });

  it("commits the removal as a registry change authored by the actor", async () => {
    seedRegistry("demo");
    installStoreDir("demo");

    await removeInstalledSkill("demo", "Admin@Example.com", { filePath });

    const [files, options] = commitPrivateAccessMock.mock.calls.at(-1) as [
      Record<string, string>,
      { message: string; authorEmail: string },
    ];
    expect(Object.keys(files)).toEqual(["access/skills.yaml"]);
    expect(options.message).toBe("chore(access): remove skill demo");
    expect(options.authorEmail).toBe("admin@example.com");
  });

  it("leaves the store directory in place when the registry write is refused", async () => {
    seedRegistry("demo");
    const dir = installStoreDir("demo");
    commitPrivateAccessMock.mockResolvedValue({ ok: false, error: "private access checkout unavailable" });

    const result = await removeInstalledSkill("demo", "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "private access checkout unavailable" });
    expect(existsSync(dir)).toBe(true);
  });

  it("removes nothing for a caller without manageAccess", async () => {
    seedRegistry("demo");
    const dir = installStoreDir("demo");
    canMock.mockReturnValue(false);

    const result = await removeInstalledSkill("demo", "nobody@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(existsSync(dir)).toBe(true);
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("clears a hand-seeded reserved slug from the registry without touching the store", async () => {
    seedRegistry("kb");

    const result = await removeInstalledSkill("kb", "admin@example.com", { filePath });

    expect(result).toEqual({ ok: true });
    const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
    expect(files["access/skills.yaml"]).not.toContain("kb:");
  });

  it("refuses a slug the registry does not carry", async () => {
    seedRegistry("demo");

    const result = await removeInstalledSkill("other", "admin@example.com", { filePath });

    expect(result).toEqual({ ok: false, error: "unknown skill" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});
