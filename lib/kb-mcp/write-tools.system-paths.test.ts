import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * `meetings/` is written by the meetings subsystem. It stays readable
 * everywhere (chat, search, the KB view) and is editable by nobody.
 *
 * Same mocked-git harness as `write-tools.test.ts`, its own file because that
 * one is at the file-size limit.
 */

let vaultDir: string;

vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: async () => "/fake/worktree",
  worktreeVaultRoot: () => vaultDir,
  diff: async () => "",
  discard: async () => {},
  submit: async () => ({ ok: true as const, branch: "main" }),
}));

vi.mock("@/lib/repo", () => ({ refreshRepo: async () => {} }));
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: async () => ({ webUrl: "https://gitlab.com/mr/1" }),
  }),
}));

const { createWriteTools } = await import("./write-tools");

const context = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com", ownerName: "Alice Contributor" };

function tools() {
  return Object.fromEntries(createWriteTools(context).map((t) => [t.name, t]));
}

function isError(result: CallToolResult): boolean {
  return result.isError === true;
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "system-paths-test-"));
  process.env.REPO_WRITE_TOKEN = "glpat-test-token";
});

afterEach(() => {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  delete process.env.REPO_WRITE_TOKEN;
});

describe("system-owned paths are write-deny", () => {
  it("refuses to edit a file under meetings/, leaving nothing on disk", async () => {
    const result = await tools().kb_stage_edit.handler(
      { path: "meetings/2026-08-01-standup.md", new_content: "rewritten" },
      {},
    );
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("meetings");
    expect(fs.existsSync(path.join(vaultDir, "meetings/2026-08-01-standup.md"))).toBe(false);
  });

  it("refuses to delete a file under meetings/, leaving it on disk", async () => {
    fs.mkdirSync(path.join(vaultDir, "meetings"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, "meetings/notes.md"), "kept");

    const result = await tools().kb_stage_delete.handler({ path: "meetings/notes.md" }, {});
    expect(isError(result)).toBe(true);
    expect(fs.readFileSync(path.join(vaultDir, "meetings/notes.md"), "utf8")).toBe("kept");
  });

  it("refuses the directory itself, not only files under it", async () => {
    const result = await tools().kb_stage_edit.handler({ path: "meetings", new_content: "x" }, {});
    expect(isError(result)).toBe(true);
  });

  // A raw prefix comparison would refuse this. It is a different folder.
  it("allows a sibling folder whose name merely starts with the denied one", async () => {
    const result = await tools().kb_stage_edit.handler(
      { path: "meetings-archive/2025.md", new_content: "# Archive\n" },
      {},
    );
    expect(isError(result)).toBe(false);
    expect(fs.existsSync(path.join(vaultDir, "meetings-archive/2025.md"))).toBe(true);
  });

  it("refuses a case variant, since the deny list names a folder not a spelling", async () => {
    const result = await tools().kb_stage_edit.handler({ path: "Meetings/x.md", new_content: "x" }, {});
    expect(isError(result)).toBe(true);
  });

  // Lexical resolution alone reads `alias/x.md` as an ordinary path. The write
  // then follows the link into the folder the deny list exists to protect.
  it("refuses a symlink that points into a system folder", async () => {
    fs.mkdirSync(path.join(vaultDir, "meetings"), { recursive: true });
    fs.symlinkSync(path.join(vaultDir, "meetings"), path.join(vaultDir, "alias"));

    const result = await tools().kb_stage_edit.handler({ path: "alias/x.md", new_content: "x" }, {});
    expect(isError(result)).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "meetings/x.md"))).toBe(false);
  });

  it("refuses a symlink that points out of the vault entirely", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.symlinkSync(outside, path.join(vaultDir, "escape"));

    const result = await tools().kb_stage_edit.handler({ path: "escape/x.md", new_content: "x" }, {});
    expect(isError(result)).toBe(true);
    expect(fs.existsSync(path.join(outside, "x.md"))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("opens a merge request from the remote surface even where KB_WRITE_MODE is direct", async () => {
    process.env.KB_WRITE_MODE = "direct";
    const remote = Object.fromEntries(
      createWriteTools({ ...context, forceMergeRequest: true }).map((t) => [t.name, t]),
    );
    fs.writeFileSync(path.join(vaultDir, "a.md"), "# A\n");
    const result = await remote.kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    delete process.env.KB_WRITE_MODE;

    expect(isError(result)).toBe(false);
    expect(text(result)).toContain("Merge Request");
  });

  it("names the reason, unlike the vault-escape refusal", async () => {
    const escape = await tools().kb_stage_edit.handler({ path: "../outside.md", new_content: "x" }, {});
    const system = await tools().kb_stage_edit.handler({ path: "meetings/x.md", new_content: "x" }, {});
    expect(text(escape)).toContain("outside the knowledge-base vault");
    expect(text(system)).toContain("meetings subsystem");
  });
});
