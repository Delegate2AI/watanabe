import { describe, it, expect } from "vitest";
import path from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { gatePackagesTool, createPackagesPreToolUse, type PackagesRoots } from "./gate";

// This is the security boundary that confines the headless packages
// integration job — it must be provably enforced by code (calling the gate
// function directly), not by prompt wording. Mirrors the rigor of
// lib/agent/permissions.test.ts for the interactive chat gate.

const ROOTS: PackagesRoots = {
  worktreeVault: "/data/worktrees/pkg-thread-1/docs",
  packageDir: "/data/packages/pkg-1/package",
};

describe("gatePackagesTool — Read/Glob/Grep path scoping", () => {
  it("allows Read/Glob/Grep with no explicit target (cwd = worktree vault)", () => {
    expect(gatePackagesTool("Read", {}, ROOTS)).toBe("allow");
    expect(gatePackagesTool("Glob", { pattern: "**/*.md" }, ROOTS)).toBe("allow");
    expect(gatePackagesTool("Grep", { pattern: "foo" }, ROOTS)).toBe("allow");
  });

  it("allows Read targeting a file inside the worktree vault root", () => {
    const target = path.join(ROOTS.worktreeVault, "00-overview", "index.md");
    expect(gatePackagesTool("Read", { file_path: target }, ROOTS)).toBe("allow");
  });

  it("allows Read targeting a file inside the package directory", () => {
    const target = path.join(ROOTS.packageDir, "FILES", "doc.md");
    expect(gatePackagesTool("Read", { file_path: target }, ROOTS)).toBe("allow");
  });

  it("allows Glob/Grep targeting either root via the 'path' field", () => {
    expect(gatePackagesTool("Glob", { path: ROOTS.worktreeVault }, ROOTS)).toBe("allow");
    expect(gatePackagesTool("Grep", { path: ROOTS.packageDir }, ROOTS)).toBe("allow");
  });

  it("allows a target that resolves to a root itself", () => {
    expect(gatePackagesTool("Read", { file_path: ROOTS.worktreeVault }, ROOTS)).toBe("allow");
    expect(gatePackagesTool("Read", { file_path: ROOTS.packageDir }, ROOTS)).toBe("allow");
  });

  it("denies Read targeting an absolute path outside both roots", () => {
    expect(gatePackagesTool("Read", { file_path: "/etc/passwd" }, ROOTS)).toBe("deny");
    expect(gatePackagesTool("Read", { file_path: "/data/worktrees/other-thread/docs/x.md" }, ROOTS)).toBe("deny");
  });

  it("denies a '../' escape from the worktree vault that doesn't land in the package dir", () => {
    const escape = path.join(ROOTS.worktreeVault, "..", "..", "..", "etc", "passwd");
    expect(gatePackagesTool("Read", { file_path: escape }, ROOTS)).toBe("deny");
  });

  it("denies a '../' escape from the package dir that doesn't land in the worktree vault", () => {
    const escape = path.join(ROOTS.packageDir, "..", "..", "..", "etc", "passwd");
    expect(gatePackagesTool("Read", { file_path: escape }, ROOTS)).toBe("deny");
  });

  it("denies Glob/Grep with a 'path' outside both roots", () => {
    expect(gatePackagesTool("Glob", { path: "/tmp/somewhere-else" }, ROOTS)).toBe("deny");
    expect(gatePackagesTool("Grep", { path: "/tmp/somewhere-else" }, ROOTS)).toBe("deny");
  });

  it("a Read whose escape from one root happens to land inside the OTHER root is allowed", () => {
    // package dir is not nested under the worktree vault in ROOTS, so a
    // relative '..' from worktreeVault can't accidentally land inside
    // packageDir here — this asserts the OR semantics directly instead.
    const target = path.join(ROOTS.packageDir, "sub", "..", "doc.md");
    expect(gatePackagesTool("Read", { file_path: target }, ROOTS)).toBe("allow");
  });
});

describe("gatePackagesTool — always-allowed tools", () => {
  it("allows TodoWrite and the read/staging kb_* tools", () => {
    for (const t of [
      "TodoWrite",
      "mcp__kb__kb_list",
      "mcp__kb__kb_read",
      "mcp__kb__kb_search",
      "mcp__kb__kb_index",
      "mcp__kb__kb_stage_edit",
      "mcp__kb__kb_stage_delete",
      "mcp__kb__kb_diff",
    ]) {
      expect(gatePackagesTool(t, {}, ROOTS)).toBe("allow");
    }
  });
});

describe("gatePackagesTool — always-denied tools", () => {
  it("denies kb_submit and kb_discard (the runner lands the change itself)", () => {
    expect(gatePackagesTool("mcp__kb__kb_submit", {}, ROOTS)).toBe("deny");
    expect(gatePackagesTool("mcp__kb__kb_discard", {}, ROOTS)).toBe("deny");
  });

  it("denies Bash", () => {
    expect(gatePackagesTool("Bash", { command: "ls" }, ROOTS)).toBe("deny");
  });

  it("denies web tools", () => {
    expect(gatePackagesTool("WebSearch", { query: "x" }, ROOTS)).toBe("deny");
    expect(gatePackagesTool("WebFetch", { url: "https://example.com" }, ROOTS)).toBe("deny");
  });

  it("denies Edit/Write/MultiEdit and unknown MCP tools", () => {
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit", "mcp__other__do_thing"]) {
      expect(gatePackagesTool(t, {}, ROOTS)).toBe("deny");
    }
  });

  it("denies an unrecognized tool name", () => {
    expect(gatePackagesTool("SomeFutureTool", {}, ROOTS)).toBe("deny");
  });
});

// The narrower shape createPackagesPreToolUse actually returns (always the
// synchronous PreToolUse variant) — avoids destructuring against the SDK's
// full HookJSONOutput union (which also includes AsyncHookJSONOutput, with no
// hookSpecificOutput field at all) in every test below.
type PreToolUseSyncOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
  };
};

describe("createPackagesPreToolUse — HookCallback wiring", () => {
  const hook = createPackagesPreToolUse(ROOTS);

  async function run(toolName: string, toolInput: unknown): Promise<PreToolUseSyncOutput> {
    const input = { tool_name: toolName, tool_input: toolInput } as PreToolUseHookInput;
    const output = await hook(input, undefined, { signal: new AbortController().signal });
    return output as unknown as PreToolUseSyncOutput;
  }

  it("returns the exact allow hookSpecificOutput shape", async () => {
    const output = await run("TodoWrite", {});
    expect(output).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
  });

  it("returns the exact deny hookSpecificOutput shape with a non-empty reason", async () => {
    const output = await run("Bash", { command: "ls" });
    const specific = output.hookSpecificOutput;
    expect(specific.hookEventName).toBe("PreToolUse");
    expect(specific.permissionDecision).toBe("deny");
    expect(typeof specific.permissionDecisionReason).toBe("string");
    expect(specific.permissionDecisionReason!.length).toBeGreaterThan(0);
  });

  it("denies kb_submit/kb_discard with a reason mentioning the runner lands the change", async () => {
    const output = await run("mcp__kb__kb_submit", {});
    expect(output.hookSpecificOutput.permissionDecisionReason?.toLowerCase()).toContain("runner");
  });

  it("never returns an 'ask'/'confirm' decision for any tool", async () => {
    for (const t of ["Read", "TodoWrite", "mcp__kb__kb_submit", "mcp__kb__kb_discard", "Bash", "WebSearch", "Unknown"]) {
      const output = await run(t, {});
      expect(["allow", "deny"]).toContain(output.hookSpecificOutput.permissionDecision);
    }
  });
});
