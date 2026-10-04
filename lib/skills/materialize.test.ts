import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeSkillsPlugin } from "./materialize";
import { invalidateSkillRegistryCache } from "./registry";

/**
 * Shape and caching of the per-clearance plugin directory. The clearance
 * security properties (fail-closed defaults, key separation, broken store
 * entries) live in materialize.clearance.test.ts.
 */

type Fixture = { slug: string; groups: string[]; commit?: string };

let root: string;
let storeDir: string;
let outDir: string;
let registryPath: string;

function installSkill(slug: string): void {
  mkdirSync(path.join(storeDir, slug), { recursive: true });
  writeFileSync(
    path.join(storeDir, slug, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${slug} skill\n---\n\nBody.\n`,
  );
}

function writeRegistry(entries: Fixture[], mtimeSeconds = 1_700_000_000): void {
  const lines = ["skills:"];
  for (const entry of entries) {
    lines.push(
      `  ${entry.slug}:`,
      `    title: ${entry.slug}`,
      "    source:",
      "      type: git",
      "      url: https://gitlab.example.com/acme/skills.git",
      "      ref: main",
      `      commit: ${entry.commit ?? "4f2a91c"}`,
      `    groups: [${entry.groups.map((group) => JSON.stringify(group)).join(", ")}]`,
    );
  }
  writeFileSync(registryPath, `${lines.join("\n")}\n`);
  // Pinned explicitly so a rewrite within the same filesystem timestamp tick
  // still reads as a different file to both the registry cache and the
  // materialization key.
  utimesSync(registryPath, mtimeSeconds, mtimeSeconds);
  invalidateSkillRegistryCache();
}

function materialize(clearance: string[]) {
  return materializeSkillsPlugin(clearance, { registryPath, storeDir, outDir });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-mat-"));
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

describe("materializeSkillsPlugin", () => {
  it("includes only the skills the clearance can see, and the rest are absent on disk", () => {
    installSkill("brand");
    installSkill("deploy");
    writeRegistry([
      { slug: "brand", groups: ["all-hands"] },
      { slug: "deploy", groups: ["engineering"] },
    ]);

    const result = materialize(["all-hands"]);

    expect(result).not.toBeNull();
    expect(result?.slugs).toEqual(["brand"]);
    expect(existsSync(path.join(result!.pluginPath, "skills", "brand"))).toBe(true);
    expect(existsSync(path.join(result!.pluginPath, "skills", "deploy"))).toBe(false);
  });

  it("writes a plugin manifest and links each skill to its store directory", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);

    const result = materialize(["all-hands"]);
    const pluginPath = result!.pluginPath;

    const manifest = JSON.parse(
      readFileSync(path.join(pluginPath, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("watanabe-skills");
    expect(manifest.version).toBe("1.0.0");
    expect(realpathSync(path.join(pluginPath, "skills", "brand"))).toBe(
      realpathSync(path.join(storeDir, "brand")),
    );
    expect(readFileSync(path.join(pluginPath, "skills", "brand", "SKILL.md"), "utf8")).toContain(
      "name: brand",
    );
  });

  it("reuses the existing directory for a repeat call with the same clearance", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);

    const first = materialize(["all-hands"]);
    const manifestPath = path.join(first!.pluginPath, ".claude-plugin", "plugin.json");
    const before = statSync(manifestPath);

    const second = materialize(["all-hands"]);
    const after = statSync(manifestPath);

    expect(second?.pluginPath).toBe(first?.pluginPath);
    // A rebuild stages a fresh tree and renames it into place, so the manifest
    // would land on a new inode. Same inode means nothing was rebuilt.
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("rebuilds under a new path when the registry file changes", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    const first = materialize(["all-hands"]);

    writeRegistry([{ slug: "brand", groups: ["all-hands"], commit: "9e1d0aa" }], 1_700_009_999);
    const second = materialize(["all-hands"]);

    expect(second).not.toBeNull();
    expect(second?.pluginPath).not.toBe(first?.pluginPath);
    expect(existsSync(path.join(second!.pluginPath, "skills", "brand"))).toBe(true);
  });

  it("rebuilds under a new path when a pinned commit changes", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    const first = materialize(["all-hands"]);

    // Same clearance and same visible slug: only the pin moved, and that alone
    // has to produce a different materialization.
    writeRegistry([{ slug: "brand", groups: ["all-hands"], commit: "abc1234" }], 1_700_000_000);
    const second = materialize(["all-hands"]);

    expect(second?.pluginPath).not.toBe(first?.pluginPath);
  });

  it("skips a registry entry whose store directory is missing", () => {
    installSkill("brand");
    writeRegistry([
      { slug: "brand", groups: ["all-hands"] },
      { slug: "ghost", groups: ["all-hands"] },
    ]);

    const result = materialize(["all-hands"]);

    expect(result?.slugs).toEqual(["brand"]);
    expect(existsSync(path.join(result!.pluginPath, "skills", "ghost"))).toBe(false);
  });

  it("returns null and creates nothing when no skill is visible", () => {
    installSkill("deploy");
    writeRegistry([{ slug: "deploy", groups: ["engineering"] }]);

    expect(materialize(["all-hands"])).toBeNull();
    expect(existsSync(outDir)).toBe(false);
  });

  it("returns null when there is no registry file at all", () => {
    expect(materialize(["all-hands"])).toBeNull();
    expect(existsSync(outDir)).toBe(false);
  });

  it("returns null instead of throwing when the output root cannot be created", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    // A plain file where the output directory belongs: every mkdir under it
    // fails with ENOTDIR, which must degrade to a session without skills.
    writeFileSync(outDir, "not a directory\n");

    expect(materialize(["all-hands"])).toBeNull();
  });
});
