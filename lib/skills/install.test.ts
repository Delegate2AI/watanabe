import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsStoreDir } from "./config";
import { toRegistryCompat } from "./install";
import { landSkillDir, uninstallSkill } from "./install-store";

/**
 * Store-side atomics: an install either lands whole or leaves the store
 * exactly as it found it, and a slug can never be used to write outside the
 * store.
 */

const ENV_KEYS = ["PORTAL_SKILLS_DIR"];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-store-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** A staged skill directory sitting where a real staging dir would sit. */
function stage(name: string, body: string): string {
  const dir = path.join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), body);
  return dir;
}

function storeDir(slug: string): string {
  return path.join(skillsStoreDir(), slug);
}

describe("landSkillDir", () => {
  it("moves a staged directory into the store under its slug", () => {
    landSkillDir(stage("staged", "first"), "brand-guidelines");

    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toBe("first");
    expect(readdirSync(skillsStoreDir())).toEqual(["brand-guidelines"]);
  });

  it("replaces an existing install without leaving an aside directory behind", () => {
    landSkillDir(stage("first", "first"), "brand-guidelines");
    const stale = path.join(storeDir("brand-guidelines"), "references", "old.md");
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, "old");

    landSkillDir(stage("second", "second"), "brand-guidelines");

    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toBe("second");
    expect(existsSync(stale)).toBe(false);
    expect(readdirSync(skillsStoreDir())).toEqual(["brand-guidelines"]);
  });

  it("restores the previous install when the rename into place fails", () => {
    landSkillDir(stage("first", "first"), "brand-guidelines");

    expect(() => landSkillDir(path.join(tmpRoot, "does-not-exist"), "brand-guidelines")).toThrow();

    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toBe("first");
    expect(readdirSync(skillsStoreDir())).toEqual(["brand-guidelines"]);
  });

  it("refuses a slug that would write outside the store", () => {
    const staged = stage("evil", "evil");

    expect(() => landSkillDir(staged, "../evil")).toThrow(/slug/);

    expect(existsSync(path.join(tmpRoot, "evil"))).toBe(true);
    expect(existsSync(path.join(tmpRoot, "..", "evil"))).toBe(false);
  });

  it("refuses a reserved slug", () => {
    expect(() => landSkillDir(stage("kb", "kb"), "kb")).toThrow(/reserved/);
  });
});

describe("uninstallSkill", () => {
  it("removes the store directory and tolerates a second call", () => {
    landSkillDir(stage("staged", "first"), "brand-guidelines");

    uninstallSkill("brand-guidelines");
    uninstallSkill("brand-guidelines");

    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("tolerates a store that was never created", () => {
    expect(() => uninstallSkill("never-installed")).not.toThrow();
  });

  it("refuses an unsafe slug rather than removing a path outside the store", () => {
    const victim = path.join(tmpRoot, "victim");
    mkdirSync(victim, { recursive: true });

    expect(() => uninstallSkill("../victim")).toThrow(/slug/);

    expect(existsSync(victim)).toBe(true);
  });
});

describe("toRegistryCompat", () => {
  it("keeps scripts and tools and drops the validator's advisory-only fields", () => {
    const compat = toRegistryCompat({
      ok: true,
      name: "Brand",
      slug: "brand",
      description: "d",
      compat: {
        scripts: ["scripts/a.py"],
        tools: ["Edit"],
        urls: ["https://example.com"],
        blockedScripts: ["scripts/curl.py"],
      },
    });

    expect(compat).toEqual({ scripts: ["scripts/a.py"], tools: ["Edit"] });
    expect(Object.keys(compat).sort()).toEqual(["scripts", "tools"]);
  });
});
