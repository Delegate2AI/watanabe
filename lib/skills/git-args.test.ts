import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGitRef, checkGitRemote, gitCloneArgs, resolveSubdir } from "./git-args";

/**
 * The argument guards on their own, with no git binary and no clone involved.
 * These are the checks that have to hold regardless of which git is in the
 * image, so they are pinned here rather than only through an install.
 */

function expectFail(result: ReturnType<typeof checkGitRemote>): string {
  if (result.ok) throw new Error("expected the check to fail");
  return result.reason;
}

describe("gitCloneArgs", () => {
  it("terminates the argv with -- before both untrusted positionals", () => {
    const args = gitCloneArgs("https://example.com/x.git", "main", "/tmp/dest");

    const terminator = args.indexOf("--");
    expect(terminator).toBeGreaterThan(-1);
    expect(args[terminator + 1]).toBe("https://example.com/x.git");
    expect(args[terminator + 2]).toBe("/tmp/dest");
    expect(args.indexOf("main")).toBeLessThan(terminator);
  });
});

describe("checkGitRemote", () => {
  it("accepts the remote shapes the schema deliberately allows", () => {
    for (const url of [
      "https://gitlab.example.com/acme/skills.git",
      "ssh://git@gitlab.example.com/acme/skills.git",
      "git@gitlab.example.com:acme/skills.git",
      "file:///srv/skills",
      "/srv/skills",
    ]) {
      expect(checkGitRemote(url).ok).toBe(true);
    }
  });

  it("refuses a remote that git would read as a flag", () => {
    expect(expectFail(checkGitRemote("--upload-pack=id"))).toContain("dash");
  });

  it("refuses a transport-helper remote", () => {
    expect(expectFail(checkGitRemote('ext::sh -c "id"'))).toContain("transport-helper");
  });

  it("refuses an unsupported scheme", () => {
    expect(expectFail(checkGitRemote("ftp://example.com/x.git"))).toContain("scheme");
  });

  it("refuses a dash-leading host in a scheme remote", () => {
    expect(expectFail(checkGitRemote("ssh://-oProxyCommand=id/x"))).toContain("host may not start with a dash");
  });

  it("refuses a dash-leading host after userinfo", () => {
    expect(expectFail(checkGitRemote("ssh://git@-oProxyCommand=id/x"))).toContain("host may not start with a dash");
  });

  it("refuses a dash-leading host in a scp-like remote", () => {
    // The scp-like host charset has no `=`, so the option-looking forms that
    // carry one are already refused as unrecognized. This is the form that
    // does match the scp-like shape and so needs the host check itself.
    expect(expectFail(checkGitRemote("user@-oHost:x"))).toContain("host may not start with a dash");
    expect(checkGitRemote("git@-oProxyCommand=id:repo.git").ok).toBe(false);
  });

  it("refuses a dash-leading userinfo, which git hands ssh as one argument", () => {
    // Git does not pass a bare hostname: `ssh://-Fnope@example.com/x` reaches
    // ssh as the single argv element `-Fnope@example.com`, so checking only
    // the part after the `@` misses it entirely.
    for (const url of ["ssh://-Fnope@example.com/x", "ssh://-oProxyCommand=id@example.com/x"]) {
      expect(expectFail(checkGitRemote(url))).toContain("host may not start with a dash");
    }
    // The scp-like spelling is caught one check earlier, by the leading dash.
    expect(checkGitRemote("-Fnope@example.com:x").ok).toBe(false);
  });

  it("does not mistake an absolute local path for a dash-leading host", () => {
    // A path has no authority at all, and a colon after a slash is not scp
    // syntax by git's own rule, so neither of these is an option smuggle.
    expect(checkGitRemote("/srv/skills@-weird").ok).toBe(true);
    expect(checkGitRemote("/srv/skills@-weird:tag").ok).toBe(true);
  });

  it("refuses control characters and an empty remote", () => {
    expect(expectFail(checkGitRemote("https://example.com/x\n--upload-pack=id"))).toContain("control characters");
    expect(expectFail(checkGitRemote("   "))).toContain("empty");
  });
});

describe("checkGitRef", () => {
  it("accepts a branch or tag name", () => {
    expect(checkGitRef("main").ok).toBe(true);
    expect(checkGitRef("release/v1.2.3").ok).toBe(true);
  });

  it("refuses a ref that git would read as a flag, and other unusable shapes", () => {
    for (const ref of ["--upload-pack=id", "-u", "a..b", "x.lock", ""]) {
      expect(checkGitRef(ref).ok).toBe(false);
    }
  });
});

describe("resolveSubdir", () => {
  let root: string;
  let clone: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-subdir-"));
    clone = path.join(root, "clone");
    mkdirSync(path.join(clone, "skills", "brand"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves a plain subdir, and the clone root when none is given", () => {
    const sub = resolveSubdir(clone, "skills/brand");
    expect(sub.ok).toBe(true);
    if (sub.ok) expect(sub.value.endsWith(path.join("skills", "brand"))).toBe(true);
    expect(resolveSubdir(clone, undefined).ok).toBe(true);
  });

  it("refuses lexical escapes", () => {
    expect(expectFail(resolveSubdir(clone, "../../etc"))).toContain("traversal");
    expect(expectFail(resolveSubdir(clone, "/etc"))).toContain("traversal");
    expect(expectFail(resolveSubdir(clone, ".git"))).toContain(".git");
    expect(expectFail(resolveSubdir(clone, "  "))).toContain("empty");
  });

  it("refuses a symlink in an intermediate component that leaves the clone", () => {
    const outside = path.join(root, "outside");
    mkdirSync(path.join(outside, "victim"), { recursive: true });
    writeFileSync(path.join(outside, "victim", "SKILL.md"), "x");
    symlinkSync(outside, path.join(clone, "hop"));

    // Lexically "hop/victim" is inside the clone. Only realpath sees otherwise.
    expect(expectFail(resolveSubdir(clone, "hop/victim"))).toContain("escapes the clone through a symlink");
  });

  it("refuses a symlink that reaches the repository's own .git", () => {
    mkdirSync(path.join(clone, ".git"), { recursive: true });
    symlinkSync(path.join(clone, ".git"), path.join(clone, "plumbing"));

    expect(expectFail(resolveSubdir(clone, "plumbing"))).toContain(".git");
  });

  it("refuses a dangling symlink rather than throwing", () => {
    symlinkSync(path.join(root, "nowhere"), path.join(clone, "broken"));

    expect(expectFail(resolveSubdir(clone, "broken"))).toContain("real directory");
  });

  it("allows a symlink that stays inside the clone", () => {
    symlinkSync(path.join(clone, "skills", "brand"), path.join(clone, "shortcut"));

    expect(resolveSubdir(clone, "shortcut").ok).toBe(true);
  });
});
