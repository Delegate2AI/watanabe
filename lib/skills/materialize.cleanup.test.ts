import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateMaterializedSkills, materializeSkillsPlugin } from "./materialize";
import { STAGING_PREFIX } from "./materialize-build";
import { invalidateSkillRegistryCache } from "./registry";

/**
 * Blast radius of the cleanup path, and the exclusivity of a cached tree. The
 * invalidate helper takes a directory argument and force-deletes recursively,
 * so what it will and will not touch is the whole of its safety argument.
 */

let root: string;
let storeDir: string;
let outDir: string;
let registryPath: string;

function installSkill(slug: string): void {
  mkdirSync(path.join(storeDir, slug), { recursive: true });
  writeFileSync(path.join(storeDir, slug, "SKILL.md"), `---\nname: ${slug}\n---\n\nBody.\n`);
}

function writeRegistry(slugs: string[]): void {
  const lines = ["skills:"];
  for (const slug of slugs) {
    lines.push(
      `  ${slug}:`,
      `    title: ${slug}`,
      "    source:",
      "      type: git",
      "      url: https://gitlab.example.com/acme/skills.git",
      "      ref: main",
      "      commit: 4f2a91c",
      '    groups: ["all-hands"]',
    );
  }
  writeFileSync(registryPath, `${lines.join("\n")}\n`);
  utimesSync(registryPath, 1_700_000_000, 1_700_000_000);
  invalidateSkillRegistryCache();
}

function materialize(clearance: string[]) {
  return materializeSkillsPlugin(clearance, { registryPath, storeDir, outDir });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-clean-"));
  storeDir = path.join(root, "store");
  outDir = path.join(root, "materialized");
  registryPath = path.join(root, "skills.yaml");
  mkdirSync(storeDir, { recursive: true });
  process.env.SKILLS_ENABLED = "1";
  invalidateSkillRegistryCache();
});

afterEach(() => {
  delete process.env.SKILLS_ENABLED;
  invalidateSkillRegistryCache();
  rmSync(root, { recursive: true, force: true });
});

describe("invalidateMaterializedSkills blast radius", () => {
  it("deletes nothing when handed a directory that is not a materialization root", () => {
    // The shape of a real data directory: exactly what a misconfigured caller,
    // or a caller that passed the store dir by mistake, would hand over.
    const dataDir = path.join(root, "data");
    mkdirSync(path.join(dataDir, "skills", "brand"), { recursive: true });
    writeFileSync(path.join(dataDir, "portal.db"), "sqlite\n");
    writeFileSync(path.join(dataDir, "skills", "brand", "SKILL.md"), "---\nname: brand\n---\n");

    invalidateMaterializedSkills(dataDir);

    expect(existsSync(path.join(dataDir, "portal.db"))).toBe(true);
    expect(existsSync(path.join(dataDir, "skills", "brand", "SKILL.md"))).toBe(true);
    expect(readdirSync(dataDir).sort()).toEqual(["portal.db", "skills"]);
  });

  it("leaves the installed skill store intact when handed the store directory", () => {
    installSkill("brand");
    installSkill("deploy");

    invalidateMaterializedSkills(storeDir);

    expect(readdirSync(storeDir).sort()).toEqual(["brand", "deploy"]);
    expect(existsSync(path.join(storeDir, "brand", "SKILL.md"))).toBe(true);
  });

  it("removes key-shaped children and spares everything else in the root", () => {
    installSkill("brand");
    writeRegistry(["brand"]);
    const result = materialize(["all-hands"]);
    // Neighbours a future feature might legitimately keep alongside the caches.
    writeFileSync(path.join(outDir, "notes.txt"), "keep me\n");
    mkdirSync(path.join(outDir, "not-a-key"), { recursive: true });

    invalidateMaterializedSkills(outDir);

    expect(existsSync(result!.pluginPath)).toBe(false);
    expect(readdirSync(outDir).sort()).toEqual(["not-a-key", "notes.txt"]);
  });

  it("never follows a symlink out of the root while cleaning up", () => {
    installSkill("brand");
    writeRegistry(["brand"]);
    materialize(["all-hands"]);

    invalidateMaterializedSkills(outDir);

    // The materialized tree linked to the store, so a cleanup that dereferenced
    // its links would have taken the skill with it.
    expect(existsSync(path.join(storeDir, "brand", "SKILL.md"))).toBe(true);
  });

  it("reaps an abandoned staging directory but leaves a fresh one alone", () => {
    mkdirSync(outDir, { recursive: true });
    const abandoned = mkdtempSync(path.join(outDir, STAGING_PREFIX));
    const fresh = mkdtempSync(path.join(outDir, STAGING_PREFIX));
    writeFileSync(path.join(abandoned, "marker"), "x\n");
    const longAgo = Date.now() / 1000 - 3600;
    utimesSync(abandoned, longAgo, longAgo);

    invalidateMaterializedSkills(outDir);

    expect(existsSync(abandoned)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe("cached plugin exclusivity", () => {
  it("rebuilds a cached tree that holds a skill the caller may not see", () => {
    installSkill("brand");
    installSkill("deploy");
    writeRegistry(["brand"]);
    const first = materialize(["all-hands"]);
    // A superset tree is only reachable through a key collision or tampering,
    // and neither may end up in a session: the extra skill's frontmatter would
    // be folded into the system prompt.
    const smuggled = path.join(first!.pluginPath, "skills", "deploy");
    mkdirSync(smuggled, { recursive: true });
    writeFileSync(path.join(smuggled, "SKILL.md"), "---\nname: deploy\n---\n");

    const second = materialize(["all-hands"]);

    expect(second?.pluginPath).toBe(first?.pluginPath);
    expect(second?.slugs).toEqual(["brand"]);
    expect(existsSync(smuggled)).toBe(false);
    expect(existsSync(path.join(second!.pluginPath, "skills", "brand", "SKILL.md"))).toBe(true);
  });

  it("does not reuse a directory built from a different store", () => {
    const otherStore = path.join(root, "other-store");
    mkdirSync(path.join(otherStore, "brand"), { recursive: true });
    writeFileSync(path.join(otherStore, "brand", "SKILL.md"), "---\nname: other\n---\n");
    installSkill("brand");
    writeRegistry(["brand"]);

    const first = materializeSkillsPlugin(["all-hands"], { registryPath, storeDir, outDir });
    const second = materializeSkillsPlugin(["all-hands"], {
      registryPath,
      storeDir: otherStore,
      outDir,
    });

    expect(second?.pluginPath).not.toBe(first?.pluginPath);
  });
});
