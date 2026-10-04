import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALLOWED_TOOLS } from "@/lib/agent/permissions";
import { EXPOSED_TOOLS } from "./compat";
import { validateSkillDir } from "./validate";

function skillMd(extraFrontmatter: string[], body: string): string {
  return [
    "---",
    "name: My Skill",
    "description: Does a thing.",
    ...extraFrontmatter,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/** Narrows to the ok branch so a failed validation shows its reason, not "undefined". */
function expectOk(result: ReturnType<typeof validateSkillDir>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result;
}

describe("validateSkillDir compat report", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-compat-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  it("lists scripts by extension as sorted posix relative paths", () => {
    write("SKILL.md", skillMd([], "Body."));
    write("scripts/helper.py", "print(1)\n");
    write("bin/tool.sh", "echo hi\n");
    write("references/notes.md", "not a script\n");

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.scripts).toEqual(["bin/tool.sh", "scripts/helper.py"]);
  });

  it("flags scripts the bash policy can never run, so the deny is not silent at runtime", () => {
    write("SKILL.md", skillMd([], "Body."));
    write("scripts/curl.py", "print(1)\n");
    write("scripts/env-setup.sh", "echo hi\n");
    write("scripts/gen.py", "print(1)\n");

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.scripts).toEqual(["scripts/curl.py", "scripts/env-setup.sh", "scripts/gen.py"]);
    expect(result.compat.blockedScripts).toEqual(["scripts/curl.py", "scripts/env-setup.sh"]);
  });

  it("flags nothing when every script name is runnable", () => {
    write("SKILL.md", skillMd([], "Body."));
    write("scripts/gen.py", "print(1)\n");

    expect(expectOk(validateSkillDir(root)).compat.blockedScripts).toEqual([]);
  });

  it("lists every scripted extension the spec names", () => {
    write("SKILL.md", skillMd([], "Body."));
    for (const name of ["a.sh", "b.py", "c.js", "d.ts", "e.rb"]) write(`s/${name}`, "x");

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.scripts).toEqual(["s/a.sh", "s/b.py", "s/c.js", "s/d.ts", "s/e.rb"]);
  });

  it("lists an extensionless file that carries an executable mode bit", () => {
    write("SKILL.md", skillMd([], "Body."));
    write("bin/run", "#!/usr/bin/env bash\n");
    chmodSync(path.join(root, "bin/run"), 0o755);

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.scripts).toEqual(["bin/run"]);
  });

  it("reports every allowed-tools entry the app does not expose", () => {
    write("SKILL.md", skillMd(["allowed-tools: [Bash, SomeUnknownTool, Write]"], "Body."));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.tools).toEqual(["SomeUnknownTool", "Write"]);
  });

  it("accepts allowed-tools written as a comma separated string", () => {
    write("SKILL.md", skillMd(["allowed-tools: Read, Grep, Edit"], "Body."));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.tools).toEqual(["Edit"]);
  });

  it("reports no tools when every allowed-tools entry is exposed", () => {
    const exposed = "Read, Glob, Grep, TodoWrite, WebSearch, WebFetch, Bash, Skill";
    write("SKILL.md", skillMd([`allowed-tools: [${exposed}]`], "Body."));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.tools).toEqual([]);
  });

  it("ignores an allowed-tools value that is neither a list nor a string", () => {
    write("SKILL.md", skillMd(["allowed-tools:", "  nested: true"], "Body."));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.tools).toEqual([]);
  });

  it("collects http and https URLs deduped and sorted", () => {
    const body = [
      "See https://example.com/a and https://example.com/a again.",
      "Also <http://plain.example.com/b>, and (https://example.com/c).",
    ].join("\n");
    write("SKILL.md", skillMd([], body));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.urls).toEqual([
      "http://plain.example.com/b",
      "https://example.com/a",
      "https://example.com/c",
    ]);
  });

  it("collects a URL that appears in frontmatter as well as in the body", () => {
    write("SKILL.md", skillMd(["homepage: https://frontmatter.example.com/x"], "No links here."));

    const result = expectOk(validateSkillDir(root));

    expect(result.compat.urls).toEqual(["https://frontmatter.example.com/x"]);
  });

  it("rejects a skill folder containing a symlink to a file outside it", () => {
    write("SKILL.md", skillMd([], "Body."));
    symlinkSync("/etc/hosts", path.join(root, "hosts"));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("symlink");
  });

  it("rejects a symlinked directory rather than walking through it", () => {
    write("SKILL.md", skillMd([], "Body."));
    write("real/inner.md", "x");
    symlinkSync(path.join(root, "real"), path.join(root, "link"));

    const result = validateSkillDir(root);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("symlink");
  });

  it("keeps its exposed-tool set in step with the agent's ALLOWED_TOOLS", () => {
    for (const tool of ALLOWED_TOOLS) expect(EXPOSED_TOOLS.has(tool)).toBe(true);
    expect(EXPOSED_TOOLS.size).toBe(ALLOWED_TOOLS.length + 2);
  });

  it("rejects a skill directory that is itself a symlink", () => {
    write("real/SKILL.md", skillMd([], "Body."));
    const link = path.join(root, "link");
    symlinkSync(path.join(root, "real"), link);

    const result = validateSkillDir(link);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("symlink");
  });
});
