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
import { resetConfigForTests } from "@/lib/config";
import { skillsStoreDir } from "./config";
import { installFromGit } from "./install";
import { configuredMarketplaces, installFromMarketplace, type GitInstaller } from "./marketplace";

/**
 * The marketplace install path.
 *
 * A marketplace item's url is http(s) only, so a test cannot serve the remote
 * itself the way install-git.test.ts does over `file://`. The tests below split
 * along that line:
 *
 * - Everything about what the marketplace layer accepts, and what it hands on,
 *   is tested with the real http(s) rule in force.
 * - Everything the git pipeline then DOES with a real repository (containment,
 *   validation, landing, the commit pin) runs the real `installFromGit`, with
 *   only the remote substituted through the injected installer, so the ref and
 *   subdir still come from the marketplace item.
 */

const ENV_KEYS = ["PORTAL_SKILLS_DIR", "PORTAL_CONFIG"];
const INDEX = "https://skills.example.com/index.json";

let tmpRoot: string;
let remote: string;
let seen: Array<{ url: string; ref: string; subdir?: string }>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function skillMd(name: string, description: string): string {
  return ["---", `name: ${name}`, `description: ${description}`, "---", "", "Body.", ""].join("\n");
}

const viaFixture: GitInstaller = (opts, context) => {
  seen.push(opts);
  return installFromGit({ ...opts, url: `file://${remote}` }, context);
};

/** Records only: for the cases that must be refused before any installer runs. */
const neverRuns: GitInstaller = async (opts) => {
  seen.push(opts);
  return { ok: false, reason: "the installer should not have been reached" };
};

const pick = (over: Record<string, unknown> = {}) => ({
  index: INDEX,
  name: "Brand guidelines",
  description: "How we write.",
  url: "https://gitlab.example.com/acme/skills.git",
  ...over,
});

const installed = () => (existsSync(skillsStoreDir()) ? readdirSync(skillsStoreDir()) : []);

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetConfigForTests();
  seen = [];
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-market-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");

  remote = path.join(tmpRoot, "remote");
  mkdirSync(path.join(remote, "skills", "brand"), { recursive: true });
  git(remote, "init", "-b", "main");
  git(remote, "config", "user.email", "fixture@example.com");
  git(remote, "config", "user.name", "Fixture");
  writeFileSync(path.join(remote, "skills", "brand", "SKILL.md"), skillMd("Brand Guidelines", "How we write."));
  git(remote, "add", "-A");
  git(remote, "commit", "-m", "initial");
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetConfigForTests();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("installFromMarketplace, url scheme", () => {
  // The manual git tab accepts these on purpose. A marketplace pick must not:
  // the url came from a remote JSON document, so accepting file:// would let a
  // hostile index make the server clone its own repositories into the store.
  const localish = [
    "file:///srv/git/internal-runbooks.git",
    "/srv/git/internal-runbooks.git",
    "git@gitlab.example.com:acme/skills.git",
    "ssh://git@gitlab.example.com/acme/skills.git",
  ];

  for (const url of localish) {
    it(`refuses an item whose url is "${url}"`, async () => {
      const result = await installFromMarketplace(pick({ url }), viaFixture);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("http");
      expect(seen).toEqual([]);
      expect(installed()).toEqual([]);
    });
  }

  it("refuses the server's own fixture repository over file://", async () => {
    const item = pick({ url: `file://${remote}`, subdir: "skills/brand" });

    const result = await installFromMarketplace(item, viaFixture);

    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
    expect(installed()).toEqual([]);
  });

  it("refuses a url git would read as a flag, and one it would run as a command", async () => {
    const marker = path.join(tmpRoot, "pwned");

    for (const url of [`--upload-pack=touch ${marker}`, `ext::sh -c "touch ${marker}"`]) {
      const result = await installFromMarketplace(pick({ url }), viaFixture);
      expect(result.ok).toBe(false);
    }

    expect(seen).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a malformed index url before anything else", async () => {
    const result = await installFromMarketplace(pick({ index: "file:///etc/passwd" }), viaFixture);

    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe("installFromMarketplace, delegation", () => {
  it("goes to the real git installer when no installer is injected", async () => {
    // A closed port on loopback: the only way to reach a git clone failure here
    // is for the default path to actually be the git installer.
    const result = await installFromMarketplace(pick({ url: "http://127.0.0.1:1/nope.git", ref: "main" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("git clone failed");
    expect(installed()).toEqual([]);
  });

  it("passes the item's url, ref, and subdir through unchanged", async () => {
    await installFromMarketplace(pick({ ref: "release", subdir: "skills/brand" }), neverRuns);

    expect(seen).toEqual([
      { url: "https://gitlab.example.com/acme/skills.git", ref: "release", subdir: "skills/brand" },
    ]);
  });

  it("falls back to the default ref when the index entry pins none", async () => {
    await installFromMarketplace(pick(), neverRuns);

    expect(seen[0]?.ref).toBe("main");
  });

  it("refuses an item whose fields blow the index caps, before any installer runs", async () => {
    const result = await installFromMarketplace(pick({ name: "n".repeat(500) }), neverRuns);

    expect(result.ok).toBe(false);
    expect(seen).toEqual([]);
    expect(installed()).toEqual([]);
  });
});

describe("installFromMarketplace, through the real git pipeline", () => {
  it("installs and stamps a marketplace source carrying the resolved commit", async () => {
    const head = git(remote, "rev-parse", "HEAD");

    const result = await installFromMarketplace(pick({ ref: "main", subdir: "skills/brand" }), viaFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("brand-guidelines");
    expect(result.source).toEqual({
      type: "marketplace",
      index: INDEX,
      name: "Brand guidelines",
      url: `file://${remote}`,
      subdir: "skills/brand",
      commit: head,
    });
    expect(readFileSync(path.join(skillsStoreDir(), "brand-guidelines", "SKILL.md"), "utf8")).toContain(
      "Brand Guidelines",
    );
  });

  it("refuses an item subdir that traverses out of the clone", async () => {
    const result = await installFromMarketplace(pick({ ref: "main", subdir: "../../etc" }), viaFixture);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("traversal");
    expect(installed()).toEqual([]);
  });

  it("refuses an item subdir crossing a committed symlink, and does not move the target", async () => {
    // The same attack install-git.test.ts covers, arriving through a marketplace
    // entry: the hostile repository commits `hop -> /outside` (git stores a
    // symlink verbatim), so "hop/victim" is lexically inside the clone while
    // physically pointing anywhere. The pipeline renames rather than copies, so
    // an install that succeeded would MOVE the victim into the store.
    const outside = path.join(tmpRoot, "outside");
    const victim = path.join(outside, "victim");
    mkdirSync(victim, { recursive: true });
    writeFileSync(path.join(victim, "SKILL.md"), skillMd("Victim Skill", "Belongs elsewhere."));
    symlinkSync(outside, path.join(remote, "hop"));
    git(remote, "add", "-A");
    git(remote, "commit", "-m", "hostile symlink");

    const result = await installFromMarketplace(pick({ ref: "main", subdir: "hop/victim" }), viaFixture);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("symlink");
    expect(existsSync(path.join(victim, "SKILL.md"))).toBe(true);
    expect(installed()).toEqual([]);
  });
});

describe("configuredMarketplaces", () => {
  function writeConfig(body: string): void {
    const file = path.join(tmpRoot, "portal.yaml");
    writeFileSync(file, body);
    process.env.PORTAL_CONFIG = file;
    resetConfigForTests();
  }

  it("is empty when portal.yaml carries no skills block, so the tab stays hidden", () => {
    writeConfig("app:\n  name: Portal\n");

    expect(configuredMarketplaces()).toEqual([]);
  });

  it("returns the configured index URLs", () => {
    writeConfig(`skills:\n  marketplaces:\n    - ${INDEX}\n`);

    expect(configuredMarketplaces()).toEqual([INDEX]);
  });
});
