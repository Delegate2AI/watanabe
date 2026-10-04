import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateMaterializedSkills, materializeSkillsPlugin } from "./materialize";
import { invalidateSkillRegistryCache } from "./registry";

/**
 * The security half of the materializer: who can see what, and what happens to
 * a materialization once the thing it was built from is gone. Filtering here is
 * by physical absence, so every assertion checks the filesystem, not a list.
 */

type Fixture = { slug: string; groups: string[]; commit?: string };

let root: string;
let storeDir: string;
let outDir: string;
let registryPath: string;

function installSkill(slug: string): void {
  mkdirSync(path.join(storeDir, slug), { recursive: true });
  writeFileSync(path.join(storeDir, slug, "SKILL.md"), `---\nname: ${slug}\n---\n\nBody.\n`);
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
  utimesSync(registryPath, mtimeSeconds, mtimeSeconds);
  invalidateSkillRegistryCache();
}

function materialize(clearance: string[]) {
  return materializeSkillsPlugin(clearance, { registryPath, storeDir, outDir });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-clr-"));
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

describe("materializeSkillsPlugin clearance", () => {
  it("shows nothing to a caller with an empty clearance set", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);

    expect(materialize([])).toBeNull();
    expect(existsSync(outDir)).toBe(false);
  });

  it("shows nothing for an entry whose groups list is empty", () => {
    installSkill("orphan");
    writeRegistry([{ slug: "orphan", groups: [] }]);

    // Fail closed: an empty group list is "nobody", never "everybody".
    expect(materialize(["all-hands"])).toBeNull();
    expect(materialize(["engineering", "all-hands"])).toBeNull();
  });

  it("never shares a directory between two different clearance sets", () => {
    installSkill("brand");
    installSkill("deploy");
    writeRegistry([
      { slug: "brand", groups: ["all-hands"] },
      { slug: "deploy", groups: ["engineering"] },
    ]);

    const staff = materialize(["all-hands"]);
    const engineer = materialize(["all-hands", "engineering"]);

    expect(staff?.pluginPath).not.toBe(engineer?.pluginPath);
    expect(staff?.slugs).toEqual(["brand"]);
    expect(engineer?.slugs).toEqual(["brand", "deploy"]);
    expect(existsSync(path.join(staff!.pluginPath, "skills", "deploy"))).toBe(false);
    expect(existsSync(path.join(engineer!.pluginPath, "skills", "deploy"))).toBe(true);
  });

  it("treats the same clearance in a different order as the same set", () => {
    installSkill("brand");
    installSkill("deploy");
    writeRegistry([
      { slug: "brand", groups: ["all-hands"] },
      { slug: "deploy", groups: ["engineering"] },
    ]);

    const forward = materialize(["all-hands", "engineering"]);
    const reversed = materialize(["engineering", "all-hands"]);

    expect(reversed?.pluginPath).toBe(forward?.pluginPath);
    expect(readdirSync(outDir).length).toBe(1);
  });

  it("keeps clearance sets apart even when a group name contains the key delimiter", () => {
    installSkill("brand");
    // Visible to both callers below, so the only thing that can separate the
    // two materializations is the clearance encoding itself.
    writeRegistry([{ slug: "brand", groups: ["a", "a|b"] }]);

    const first = materialize(["a", "b|c"]);
    const second = materialize(["a|b", "c"]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.pluginPath).not.toBe(second?.pluginPath);
  });

  it("materializes nothing at all when the flag is off", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    delete process.env.SKILLS_ENABLED;

    expect(materialize(["all-hands"])).toBeNull();
    expect(existsSync(outDir)).toBe(false);
  });

  it("skips a store entry that is a file rather than a skill directory", () => {
    writeFileSync(path.join(storeDir, "brand"), "not a skill\n");
    installSkill("deploy");
    writeRegistry([
      { slug: "brand", groups: ["all-hands"] },
      { slug: "deploy", groups: ["all-hands"] },
    ]);

    const result = materialize(["all-hands"]);

    expect(result?.slugs).toEqual(["deploy"]);
    expect(existsSync(path.join(result!.pluginPath, "skills", "brand"))).toBe(false);
  });

  it("skips a store directory with no SKILL.md instead of materializing it empty", () => {
    mkdirSync(path.join(storeDir, "half"), { recursive: true });
    installSkill("deploy");
    writeRegistry([
      { slug: "half", groups: ["all-hands"] },
      { slug: "deploy", groups: ["all-hands"] },
    ]);

    expect(materialize(["all-hands"])?.slugs).toEqual(["deploy"]);
  });

  it("skips a store entry that is a symlink to somewhere else", () => {
    const outside = path.join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "SKILL.md"), "---\nname: outside\n---\n");
    symlinkSync(outside, path.join(storeDir, "sneaky"), "dir");
    writeRegistry([{ slug: "sneaky", groups: ["all-hands"] }]);

    // The store is written only by the install pipeline, which rejects
    // symlinks, so one appearing here means the store was tampered with.
    expect(materialize(["all-hands"])).toBeNull();
  });

  it("stops serving a materialization once the skill is uninstalled", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    const before = materialize(["all-hands"]);
    expect(existsSync(before!.pluginPath)).toBe(true);

    rmSync(path.join(storeDir, "brand"), { recursive: true, force: true });
    writeRegistry([], 1_700_009_999);

    expect(materialize(["all-hands"])).toBeNull();
    expect(existsSync(path.join(before!.pluginPath, "skills", "brand", "SKILL.md"))).toBe(false);
  });

  it("stops serving a cached path whose store directory vanished under it", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    const first = materialize(["all-hands"]);

    // Registry untouched, so the key is unchanged and the cached directory is
    // still on disk, but its link now dangles: it must not be handed back.
    rmSync(path.join(storeDir, "brand"), { recursive: true, force: true });

    expect(materialize(["all-hands"])).toBeNull();
    expect(first).not.toBeNull();
  });

  it("drops every materialization on invalidation without touching the store", () => {
    installSkill("brand");
    writeRegistry([{ slug: "brand", groups: ["all-hands"] }]);
    const result = materialize(["all-hands"]);

    invalidateMaterializedSkills(outDir);

    expect(existsSync(result!.pluginPath)).toBe(false);
    // The root itself stays: only its key-shaped children are removable.
    expect(readdirSync(outDir)).toEqual([]);
    // The links pointed into the store, and removing them must not follow.
    expect(existsSync(path.join(storeDir, "brand", "SKILL.md"))).toBe(true);
  });

  it("survives invalidation of a directory that was never materialized", () => {
    expect(() => invalidateMaterializedSkills(outDir)).not.toThrow();
  });
});
