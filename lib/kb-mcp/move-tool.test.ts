import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * The tool half of `kb_stage_move`: it applies a plan into the worktree, and it
 * refuses outright when the caller cannot see the whole vault, because a link
 * rewrite scoped to a partial projection cannot see what it is breaking.
 */

let vaultDir: string;
let scopedDir: string;

vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: async () => "/fake/worktree",
  worktreeVaultRoot: () => vaultDir,
}));

vi.mock("@/lib/repo", () => ({
  unfilteredVaultRoot: () => vaultDir,
  vaultRootFor: () => scopedDir,
}));

vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({}),
  resolveClearance: () => ["all-hands"],
}));

const { createMoveTool } = await import("./move-tool");

const context = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com" };

function note(root: string, rel: string, body: string): void {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body, "utf8");
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "move-tool-vault-"));
  scopedDir = vaultDir;
});

afterEach(() => {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  if (scopedDir !== vaultDir) fs.rmSync(scopedDir, { recursive: true, force: true });
});

describe("kb_stage_move", () => {
  it("applies the rename and the rewrites into the worktree", async () => {
    note(vaultDir, "a/one.md", "# One\n");
    note(vaultDir, "c/two.md", "See [[a/one]].\n");

    const result = await createMoveTool(context).handler({ from: "a/one.md", to: "b/one.md" }, {});

    expect(result.isError).not.toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "b/one.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "a/one.md"))).toBe(false);
    expect(fs.readFileSync(path.join(vaultDir, "c/two.md"), "utf8")).toContain("[[b/one]]");
    expect(text(result)).toContain("kb_diff");
  });

  it("refuses when the caller cannot see the whole vault, touching nothing", async () => {
    note(vaultDir, "a/one.md", "# One\n");
    note(vaultDir, "restricted/secret.md", "# Secret\n");
    scopedDir = fs.mkdtempSync(path.join(os.tmpdir(), "move-tool-scoped-"));
    note(scopedDir, "a/one.md", "# One\n");

    const result = await createMoveTool(context).handler({ from: "a/one.md", to: "b/one.md" }, {});

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("clearance");
    expect(fs.existsSync(path.join(vaultDir, "a/one.md"))).toBe(true);
  });

  it("reports a refused plan rather than half-applying it", async () => {
    note(vaultDir, "meetings/standup.md", "# Standup\n");

    const result = await createMoveTool(context).handler({ from: "meetings/standup.md", to: "a/standup.md" }, {});

    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "meetings/standup.md"))).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "a/standup.md"))).toBe(false);
  });
});
