import { describe, it, expect, afterEach } from "vitest";
import { buildPackagesOptions } from "./options";
import { worktreeVaultRoot } from "@/lib/repo-write";

// Asserts the actual Options object buildPackagesOptions() hands to query(),
// mirroring the rigor of lib/agent/config.test.ts for the interactive chat
// session's buildOptions().

const BUDGET_ENV = "PACKAGES_MAX_BUDGET_USD";
const TURNS_ENV = "PACKAGES_MAX_TURNS";

const BASE_PARAMS = {
  threadId: "pkg-thread-1",
  ownerEmail: "uploader@example.com",
  ownerName: "Uploader Name",
  packageDirAbs: "/data/packages/pkg-1/package",
  packageName: "handoff-v11",
};

afterEach(() => {
  delete process.env[BUDGET_ENV];
  delete process.env[TURNS_ENV];
  delete process.env.AGENT_CHAT_MODEL;
});

describe("buildPackagesOptions — cwd and scope", () => {
  it("sets cwd to the job's own worktree vault root", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.cwd).toBe(worktreeVaultRoot(BASE_PARAMS.threadId));
  });

  it("loads no repo settings", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.settingSources).toEqual([]);
  });

  it("restricts allowedTools to the read-only four", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.allowedTools).toEqual(["Read", "Glob", "Grep", "TodoWrite"]);
  });

  it("uses the claude_code preset system prompt with the integration skill appended", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    const prompt = opts.systemPrompt as { type: string; preset: string; append: string };
    expect(prompt.type).toBe("preset");
    expect(prompt.preset).toBe("claude_code");
    expect(prompt.append).toContain(BASE_PARAMS.packageName);
    expect(prompt.append).toContain(`99-reference/handoffs/${BASE_PARAMS.packageName}/`);
  });

  it("uses default permissionMode", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.permissionMode).toBe("default");
  });
});

describe("buildPackagesOptions — mcp wiring", () => {
  it("wires only the kb MCP server, no memory server key", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(Object.keys(opts.mcpServers ?? {})).toEqual(["kb"]);
  });
});

describe("buildPackagesOptions — hooks and canUseTool", () => {
  it("wires a single PreToolUse hook", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.hooks?.PreToolUse).toHaveLength(1);
    expect(opts.hooks?.PreToolUse?.[0].hooks).toHaveLength(1);
  });

  it("provides a canUseTool callback (required shape even though never reached)", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(typeof opts.canUseTool).toBe("function");
  });
});

describe("buildPackagesOptions — no streaming/memory extras", () => {
  it("omits includePartialMessages", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.includePartialMessages).toBeUndefined();
  });
});

describe("buildPackagesOptions — cost & turn caps from lib/packages/config", () => {
  it("reads maxBudgetUsd and maxTurns from PACKAGES_MAX_* env", () => {
    process.env[BUDGET_ENV] = "9.5";
    process.env[TURNS_ENV] = "42";
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.maxBudgetUsd).toBe(9.5);
    expect(opts.maxTurns).toBe(42);
  });

  it("falls back to the documented packages defaults when env is unset", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.maxBudgetUsd).toBe(5.0);
    expect(opts.maxTurns).toBe(100);
  });
});

describe("buildPackagesOptions — model", () => {
  it("defaults to claude-opus-4-8", () => {
    const opts = buildPackagesOptions(BASE_PARAMS);
    expect(opts.model).toBe("claude-opus-4-8");
  });
});
