import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Integration coverage for `kb_stage_edit`'s mechanical quality gate
 * (`isQualityGatesEnabled()`, spec 12 B2) against a REAL local git fixture:
 * a bare "remote" + a checkout `ensureWorktree` clones from, exactly like
 * `lib/repo-write.test.ts`'s own fixture. Real git is required here (unlike
 * `write-tools.test.ts`'s fully-mocked `@/lib/repo-write`) because the gate's
 * whole point is diff-scoped grandfathering: it must diff the just-staged
 * file against its actual last-committed content, not a canned string.
 */

let tmpRoot: string;
let bareDir: string;
let checkoutDir: string;
let worktreesDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// research-harness's check-em-dash.py bans U+2014 (em dash); built from a
// code point, not a literal character, so this test file stays free of the
// banned glyph itself (same convention as lib/quality/mechanical.test.ts).
const EM_DASH = String.fromCodePoint(0x2014);

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return {
    ...actual,
    remoteUrlWithToken: () => bareDir,
  };
});

const { createWriteTools } = await import("./write-tools");

const context = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com", ownerName: "Alice Contributor" };

function tools() {
  const list = createWriteTools(context);
  return Object.fromEntries(list.map((t) => [t.name, t]));
}

function isError(result: CallToolResult): boolean {
  return result.isError === true;
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR", "WORKTREE_ROOT", "QUALITY_GATES_ENABLED"] as const;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "write-tools-quality-test-"));
  bareDir = path.join(tmpRoot, "remote.git");
  checkoutDir = path.join(tmpRoot, "checkout");
  worktreesDir = path.join(tmpRoot, "worktrees");

  git(tmpRoot, "init", "--bare", "-b", "main", bareDir);

  const seedDir = path.join(tmpRoot, "seed");
  git(tmpRoot, "clone", bareDir, seedDir);
  git(seedDir, "config", "user.email", "seed@example.com");
  git(seedDir, "config", "user.name", "Seed");
  fs.mkdirSync(path.join(seedDir, "docs"), { recursive: true });
  // Committed content already carries an em dash in an UNCHANGED line, to
  // prove the gate only checks ADDED lines (diff-scoped grandfathering), not
  // the whole file.
  fs.writeFileSync(path.join(seedDir, "docs", "legacy.md"), `# Legacy\n\nOld prose ${EM_DASH} already committed.\n`);
  git(seedDir, "add", "-A");
  git(seedDir, "commit", "-m", "initial");
  git(seedDir, "push", "origin", "main");

  git(tmpRoot, "clone", bareDir, checkoutDir);
  git(checkoutDir, "config", "user.email", "checkout@example.com");
  git(checkoutDir, "config", "user.name", "Checkout");

  for (const k of ENV_KEYS) delete process.env[k];
  process.env.LOCAL_REPO_PATH = checkoutDir;
  process.env.VAULT_SUBDIR = "docs";
  process.env.WORKTREE_ROOT = worktreesDir;
  process.env.REPO_WRITE_TOKEN = "glpat-test-token";
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.REPO_WRITE_TOKEN;
});

describe("kb_stage_edit mechanical quality gate", () => {
  it("blocks a NEW file whose added lines contain an em dash, and does not leave it staged", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const result = await tools().kb_stage_edit.handler(
      { path: "new-page.md", new_content: `# New page\n\nGrowth accelerated ${EM_DASH} fast.\n` },
      {},
    );

    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("em-dash");

    const abs = path.join(worktreesDir, "thread-1", "docs", "new-page.md");
    expect(fs.existsSync(abs)).toBe(false); // new file was removed, not left staged

    const status = git(path.join(worktreesDir, "thread-1"), "status", "--porcelain");
    expect(status.trim()).toBe(""); // worktree is clean
  });

  it("stages the same content successfully once the em dash is removed", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const result = await tools().kb_stage_edit.handler(
      { path: "new-page.md", new_content: "# New page\n\nGrowth accelerated fast.\n" },
      {},
    );

    expect(isError(result)).toBe(false);
    const abs = path.join(worktreesDir, "thread-1", "docs", "new-page.md");
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe("# New page\n\nGrowth accelerated fast.\n");
  });

  it("blocks an EXISTING tracked file when the ADDED lines contain an em dash, restoring committed content", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const result = await tools().kb_stage_edit.handler(
      {
        path: "legacy.md",
        new_content: `# Legacy\n\nOld prose ${EM_DASH} already committed.\n\nNew line added ${EM_DASH} bad.\n`,
      },
      {},
    );

    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("em-dash");

    const abs = path.join(worktreesDir, "thread-1", "docs", "legacy.md");
    expect(fs.readFileSync(abs, "utf8")).toBe(`# Legacy\n\nOld prose ${EM_DASH} already committed.\n`);

    const status = git(path.join(worktreesDir, "thread-1"), "status", "--porcelain");
    expect(status.trim()).toBe(""); // unstaged and working tree matches HEAD
  });

  it("diff-scoped grandfathering: editing a file with a pre-existing em dash succeeds when the ADDED lines are clean", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const result = await tools().kb_stage_edit.handler(
      {
        path: "legacy.md",
        new_content: `# Legacy\n\nOld prose ${EM_DASH} already committed.\n\nA brand new, clean paragraph.\n`,
      },
      {},
    );

    expect(isError(result)).toBe(false);
    const abs = path.join(worktreesDir, "thread-1", "docs", "legacy.md");
    expect(fs.readFileSync(abs, "utf8")).toBe(
      `# Legacy\n\nOld prose ${EM_DASH} already committed.\n\nA brand new, clean paragraph.\n`,
    );
  });

  it("a rejected edit restores the PRIOR staged edit to the same path, not HEAD", async () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const clean = await tools().kb_stage_edit.handler(
      { path: "p.md", new_content: "# P\n\nA clean first draft.\n" },
      {},
    );
    expect(isError(clean)).toBe(false);

    const abs = path.join(worktreesDir, "thread-1", "docs", "p.md");
    expect(fs.readFileSync(abs, "utf8")).toBe("# P\n\nA clean first draft.\n");

    const violating = await tools().kb_stage_edit.handler(
      { path: "p.md", new_content: `# P\n\nA clean first draft.\n\nA second, bad line ${EM_DASH} nope.\n` },
      {},
    );
    expect(isError(violating)).toBe(true);
    expect(text(violating)).toContain("em-dash");

    // The first, still-valid staged edit must survive — not reverted to
    // HEAD (this file didn't exist at HEAD at all) and not left empty.
    expect(fs.readFileSync(abs, "utf8")).toBe("# P\n\nA clean first draft.\n");

    const status = git(path.join(worktreesDir, "thread-1"), "status", "--porcelain");
    expect(status.trim()).not.toBe(""); // the first edit is still staged/untracked, not reverted to a clean HEAD
  });

  it("flag off: an em-dash edit stages successfully (no block at all)", async () => {
    delete process.env.QUALITY_GATES_ENABLED;
    const result = await tools().kb_stage_edit.handler(
      { path: "new-page.md", new_content: `# New page\n\nGrowth accelerated ${EM_DASH} fast.\n` },
      {},
    );

    expect(isError(result)).toBe(false);
    const abs = path.join(worktreesDir, "thread-1", "docs", "new-page.md");
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe(`# New page\n\nGrowth accelerated ${EM_DASH} fast.\n`);
  });
});
