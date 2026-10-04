import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsStoreDir } from "./config";
import { installFromGit } from "./install";
import { invalidateSkillRegistryCache } from "./registry";

/**
 * Git install path, exercised against a real local fixture repository cloned
 * over `file://`. No network anywhere, same approach as `lib/repo-write.test.ts`.
 */

const ENV_KEYS = ["PORTAL_SKILLS_DIR", "MEMORY_CHECKOUT_DIR"];

let tmpRoot: string;
let remote: string;
let remoteUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "fixture@example.com");
  git(dir, "config", "user.name", "Fixture");
}

function writeFixture(rel: string, content: string): void {
  const abs = path.join(remote, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function skillMd(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", "", "Body.", ""].join("\n");
}

function storeDir(slug: string): string {
  return path.join(skillsStoreDir(), slug);
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-git-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");
  process.env.MEMORY_CHECKOUT_DIR = tmpRoot;
  invalidateSkillRegistryCache();

  remote = path.join(tmpRoot, "remote");
  initRepo(remote);
  writeFixture("skills/brand/SKILL.md", skillMd("Brand Guidelines", "How we write."));
  writeFixture("skills/brand/references/style.md", "Style notes.\n");
  writeFixture("README.md", "Fixture repo.\n");
  git(remote, "add", "-A");
  git(remote, "commit", "-m", "initial");
  remoteUrl = `file://${remote}`;
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  invalidateSkillRegistryCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeRegistry(lines: string[]): void {
  mkdirSync(path.join(tmpRoot, "access"), { recursive: true });
  writeFileSync(path.join(tmpRoot, "access", "skills.yaml"), lines.join("\n") + "\n");
  invalidateSkillRegistryCache();
}

describe("installFromGit", () => {
  it("clones a subdir, lands it, and pins the resolved commit", async () => {
    const head = git(remote, "rev-parse", "HEAD");

    const result = await installFromGit({ url: remoteUrl, ref: "main", subdir: "skills/brand" }, { sourceType: "git" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("brand-guidelines");
    expect(result.source).toEqual({
      type: "git",
      url: remoteUrl,
      ref: "main",
      subdir: "skills/brand",
      commit: head,
    });
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toContain("Brand Guidelines");
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "references", "style.md"), "utf8")).toContain("Style");
  });

  it("installs a repo whose skill is at the root and never stores the .git directory", async () => {
    const root = path.join(tmpRoot, "rootskill");
    initRepo(root);
    writeFileSync(path.join(root, "SKILL.md"), skillMd("Root Skill", "Lives at the repo root."));
    git(root, "add", "-A");
    git(root, "commit", "-m", "initial");

    const result = await installFromGit({ url: `file://${root}`, ref: "main" }, { sourceType: "git" });

    expect(result.ok).toBe(true);
    expect(readdirSync(storeDir("root-skill")).sort()).toEqual(["SKILL.md"]);
  });

  it("replaces an earlier install of the same slug and repins the commit", async () => {
    const first = await installFromGit({ url: remoteUrl, ref: "main", subdir: "skills/brand" }, { sourceType: "git" });
    expect(first.ok).toBe(true);

    rmSync(path.join(remote, "skills", "brand", "references"), { recursive: true, force: true });
    writeFixture("skills/brand/SKILL.md", skillMd("Brand Guidelines", "How we write, v2."));
    git(remote, "add", "-A");
    git(remote, "commit", "-m", "second");
    const head = git(remote, "rev-parse", "HEAD");

    const second = await installFromGit({ url: remoteUrl, ref: "main", subdir: "skills/brand" }, { sourceType: "git" });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.source).toMatchObject({ commit: head });
    expect(readFileSync(path.join(storeDir("brand-guidelines"), "SKILL.md"), "utf8")).toContain("v2");
    expect(existsSync(path.join(storeDir("brand-guidelines"), "references"))).toBe(false);
  });

  it("leaves no store directory and no staging directory when validation fails", async () => {
    writeFixture("skills/broken/SKILL.md", "no frontmatter here\n");
    git(remote, "add", "-A");
    git(remote, "commit", "-m", "broken skill");

    const result = await installFromGit({ url: remoteUrl, ref: "main", subdir: "skills/broken" }, { sourceType: "git" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("frontmatter");
    expect(existsSync(skillsStoreDir()) ? readdirSync(skillsStoreDir()) : []).toEqual([]);
    expect(readdirSync(tmpRoot).filter((name) => name.startsWith(".skill-install-"))).toEqual([]);
  });

  it("returns a reason carrying git's stderr when the ref does not exist", async () => {
    const result = await installFromGit({ url: remoteUrl, ref: "no-such-branch" }, { sourceType: "git" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no-such-branch");
  });

  it("refuses a slug already registered under a different source type, with no opt-in required", async () => {
    writeRegistry([
      "skills:",
      "  brand-guidelines:",
      "    title: Brand Guidelines",
      "    source:",
      "      type: zip",
      "      filename: brand.zip",
      "    groups: []",
    ]);

    const result = await installFromGit(
      { url: remoteUrl, ref: "main", subdir: "skills/brand" },
      { sourceType: "git" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("different source type");
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  describe("git argument injection", () => {
    it("rejects a remote that git would read as a flag", async () => {
      const marker = path.join(tmpRoot, "pwned-flag");

      const result = await installFromGit(
        { url: `--upload-pack=touch ${marker}`, ref: "main" },
        { sourceType: "git" },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("dash");
      expect(existsSync(marker)).toBe(false);
    });

    it("rejects an ext:: remote, which git treats as a command to run", async () => {
      const marker = path.join(tmpRoot, "pwned-ext");

      const result = await installFromGit(
        { url: `ext::sh -c "touch ${marker}"`, ref: "main" },
        { sourceType: "git" },
      );

      expect(result.ok).toBe(false);
      expect(existsSync(marker)).toBe(false);
    });

    it("rejects a dash-leading ssh host smuggled through the authority", async () => {
      const marker = path.join(tmpRoot, "pwned-host");

      const result = await installFromGit(
        { url: `ssh://-oProxyCommand=touch${marker}/x`, ref: "main" },
        { sourceType: "git" },
      );

      expect(result.ok).toBe(false);
      // Modern git refuses this itself ("strange hostname blocked"), so the
      // assertion is that OUR layer refused it, not that the attack failed.
      if (!result.ok) expect(result.reason).toContain("host may not start with a dash");
      expect(existsSync(marker)).toBe(false);
    });

    it("passes the remote as one argv element, so shell metacharacters are inert", async () => {
      const marker = path.join(tmpRoot, "pwned-shell");

      const result = await installFromGit(
        { url: `${remoteUrl}; touch ${marker}`, ref: "main" },
        { sourceType: "git" },
      );

      expect(result.ok).toBe(false);
      expect(existsSync(marker)).toBe(false);
    });
  });

  describe("subdir containment", () => {
    it("refuses a committed symlink in an intermediate subdir component, and does not move the target", async () => {
      // The reviewer's attack, end to end. Git stores a symlink verbatim (mode
      // 120000), so a hostile repo can commit `hop -> /outside`. The lexical
      // containment check sees "hop/victim" resolve inside the clone, and the
      // skill validator never sees `hop` at all because it lstats only the scan
      // root and the dirents INSIDE it. Since the pipeline renames rather than
      // copies, an install that succeeded here would MOVE the victim directory
      // out of its original location and into the store.
      const outside = path.join(tmpRoot, "outside");
      const victim = path.join(outside, "victim");
      mkdirSync(victim, { recursive: true });
      writeFileSync(path.join(victim, "SKILL.md"), skillMd("Victim Skill", "Belongs elsewhere."));
      symlinkSync(outside, path.join(remote, "hop"));
      git(remote, "add", "-A");
      git(remote, "commit", "-m", "hostile symlink");

      const result = await installFromGit({ url: remoteUrl, ref: "main", subdir: "hop/victim" }, { sourceType: "git" });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("symlink");
      expect(existsSync(path.join(victim, "SKILL.md"))).toBe(true);
      expect(existsSync(skillsStoreDir()) ? readdirSync(skillsStoreDir()) : []).toEqual([]);
    });

    it("rejects a subdir that traverses out of the clone", async () => {
      const result = await installFromGit({ url: remoteUrl, ref: "main", subdir: "../../etc" }, { sourceType: "git" });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("traversal");
      expect(existsSync(skillsStoreDir()) ? readdirSync(skillsStoreDir()) : []).toEqual([]);
    });

  });
});
