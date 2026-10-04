import { describe, it, expect, afterEach, vi } from "vitest";
import type { HookJSONOutput, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";

// The SDK's native per-session cutoffs are a hard safety boundary: without them
// a runaway loop could burn unbounded cost/turns on a single conversation. These
// assert the actual option object buildOptions() hands to query().

const noopHook = async (): Promise<HookJSONOutput> => ({});
const noopCanUseTool = async (): Promise<PermissionResult> => ({ behavior: "allow" });
const noopWriteContext: KbWriteContext = { getThreadId: () => "test-thread", ownerEmail: "test@example.com" };

const createMemMcpServerMock = vi.fn(() => ({ name: "mem" }) as never);
vi.mock("@/lib/memory/mem-server", () => ({
  createMemMcpServer: (...args: [string, string?]) => createMemMcpServerMock(...args),
}));
const createTasksMcpServerMock = vi.fn(() => ({ name: "tasks" }) as never);
vi.mock("@/lib/tasks/mcp", () => ({
  createTasksMcpServer: (...args: unknown[]) => createTasksMcpServerMock(...args),
}));
const { buildOptions } = await import("./config");

// Defaults documented in config.ts. Keep in sync if those change.
const DEFAULT_MAX_BUDGET_USD = 2.0;
const DEFAULT_MAX_TURNS = 40;

const BUDGET_ENV = "AGENT_MAX_BUDGET_USD";
const TURNS_ENV = "AGENT_MAX_TURNS";

afterEach(() => {
  delete process.env[BUDGET_ENV];
  delete process.env[TURNS_ENV];
  delete process.env.KB_WRITE_ENABLED;
  delete process.env.MEMORY_ENABLED;
  delete process.env.QUALITY_GATES_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
});

function systemPromptText(opts: ReturnType<typeof buildOptions>): string {
  const prompt = opts.systemPrompt as { type: "preset"; preset: "claude_code"; append?: string };
  return prompt.append ?? "";
}

describe("buildOptions — kb MCP server wiring", () => {
  it("wires the in-process kb MCP server under the 'kb' key", () => {
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.mcpServers).toBeDefined();
    expect(Object.keys(opts.mcpServers ?? {})).toEqual(["kb"]);
    // Not just present — an actual live McpServer instance (see
    // McpSdkServerConfigWithInstance in the SDK's sdk.d.ts), not a
    // serializable stdio/SSE/http config.
    expect(opts.mcpServers?.kb).toHaveProperty("instance");
  });
});

describe("buildOptions: adopting a caller-supplied session id", () => {
  it("passes an adopted session id through as sessionId, never as resume", () => {
    const options = buildOptions(
      noopHook,
      noopCanUseTool,
      noopWriteContext,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { adoptSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    );
    expect(options.sessionId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(options.resume).toBeUndefined();
  });

  it("sets no sessionId when nothing is adopted, keeping the options byte-identical", () => {
    expect(buildOptions(noopHook, noopCanUseTool, noopWriteContext)).not.toHaveProperty("sessionId");
  });

  it("declares an attachment directory as an additionalDirectories entry", () => {
    const options = buildOptions(
      noopHook,
      noopCanUseTool,
      noopWriteContext,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { attachmentDir: "/data/attachments/k/t" },
    );
    expect(options.additionalDirectories).toEqual(["/data/attachments/k/t"]);
  });

  it("sets no additionalDirectories key at all when there is no attachment directory", () => {
    expect(buildOptions(noopHook, noopCanUseTool, noopWriteContext)).not.toHaveProperty("additionalDirectories");
  });
});

describe("buildOptions: per-thread model/effort override (spec 24)", () => {
  afterEach(() => {
    delete process.env.AGENT_CHAT_MODEL;
    delete process.env.AGENT_CHAT_MODELS;
  });

  it("is DORMANT when AGENT_CHAT_MODELS is unset: byte-identical prior shape (model only, no effort)", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    // A choice is passed but must be ignored entirely while the feature is off.
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], {
      model: "claude-sonnet-4-6",
      effort: "low",
    });
    expect(opts.model).toBe("claude-opus-4-8");
    // The prior SDK option shape had NO effort field: it must stay absent.
    expect("effort" in opts).toBe(false);
  });

  it("defaults to the env model at High when enabled with no choice", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-opus-4-8";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.model).toBe("claude-opus-4-8");
    expect(opts.effort).toBe("high");
  });

  it("applies an allow-listed override to the SDK options when enabled", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-sonnet-4-6";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], {
      model: "claude-sonnet-4-6",
      effort: "low",
    });
    expect(opts.model).toBe("claude-sonnet-4-6");
    expect(opts.effort).toBe("low");
  });

  it("ignores an off-allowlist model, falling back to the default", () => {
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-opus-4-8";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], {
      model: "gpt-4o",
      effort: "high",
    });
    expect(opts.model).toBe("claude-opus-4-8");
  });

  it("keeps the cost/turn ceilings regardless of the model choice", () => {
    process.env[BUDGET_ENV] = "3.5";
    process.env[TURNS_ENV] = "12";
    process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
    process.env.AGENT_CHAT_MODELS = "claude-opus-4-8";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], {
      model: "claude-opus-4-8",
      effort: "max",
    });
    // The switch cannot escape the guards: ceilings still come from env.
    expect(opts.maxBudgetUsd).toBe(3.5);
    expect(opts.maxTurns).toBe(12);
  });
});

describe("buildOptions — cost & turn cutoffs", () => {
  it("reads maxBudgetUsd and maxTurns from env", () => {
    process.env[BUDGET_ENV] = "3.5";
    process.env[TURNS_ENV] = "12";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.maxBudgetUsd).toBe(3.5);
    expect(opts.maxTurns).toBe(12);
  });

  it("falls back to the documented defaults when env is unset", () => {
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.maxBudgetUsd).toBe(DEFAULT_MAX_BUDGET_USD);
    expect(opts.maxTurns).toBe(DEFAULT_MAX_TURNS);
  });

  it("falls back to defaults on malformed env (never NaN)", () => {
    process.env[BUDGET_ENV] = "not-a-number";
    process.env[TURNS_ENV] = "";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.maxBudgetUsd).toBe(DEFAULT_MAX_BUDGET_USD);
    expect(opts.maxTurns).toBe(DEFAULT_MAX_TURNS);
    expect(Number.isNaN(opts.maxBudgetUsd)).toBe(false);
    expect(Number.isNaN(opts.maxTurns)).toBe(false);
  });

  it("falls back to defaults on non-positive env (zero / negative)", () => {
    process.env[BUDGET_ENV] = "0";
    process.env[TURNS_ENV] = "-5";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.maxBudgetUsd).toBe(DEFAULT_MAX_BUDGET_USD);
    expect(opts.maxTurns).toBe(DEFAULT_MAX_TURNS);
  });

  it("always sets both cutoffs (a real limit, not effectively-infinite)", () => {
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(typeof opts.maxBudgetUsd).toBe("number");
    expect(opts.maxBudgetUsd).toBeGreaterThan(0);
    expect(Number.isFinite(opts.maxBudgetUsd)).toBe(true);
    expect(typeof opts.maxTurns).toBe("number");
    expect(opts.maxTurns).toBeGreaterThan(0);
    expect(Number.isFinite(opts.maxTurns)).toBe(true);
  });
});

describe("buildOptions — canUseTool wiring", () => {
  it("passes the caller's canUseTool straight through into Options", () => {
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(opts.canUseTool).toBe(noopCanUseTool);
  });
});

describe("buildOptions — system prompt, write mode off (default)", () => {
  it("claims the assistant is read-only and says nothing about staging/submitting edits", () => {
    delete process.env.KB_WRITE_ENABLED;
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text.toLowerCase()).toContain("you are read-only");
    expect(text).not.toContain("kb_stage_edit");
    expect(text).not.toContain("kb_submit");
  });

  it("documents Bash's narrow scope even when write mode is off, including that own-worktree inspection needs write mode", () => {
    delete process.env.KB_WRITE_ENABLED;
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text).toContain("SHELL ACCESS (Bash)");
    expect(text.toLowerCase()).toContain("only possible when write");
  });
});

describe("buildOptions — system prompt, write mode on", () => {
  it("does not claim read-only, and documents the staging/submit discipline", () => {
    process.env.KB_WRITE_ENABLED = "1";
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text.toLowerCase()).not.toContain("you are read-only");
    expect(text).toContain("kb_stage_edit");
    expect(text).toContain("kb_diff");
    expect(text).toContain("kb_submit");
    expect(text.toLowerCase()).toContain("confirmation");
  });

  it("documents web access as available, and raw file mutation as still blocked", () => {
    process.env.KB_WRITE_ENABLED = "1";
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text.toLowerCase()).toContain("websearch");
    expect(text).toContain("BLOCKED");
    expect(text.toLowerCase()).toContain("edit/write tools");
  });

  it("still carries every sourcing requirement from the default prompt", () => {
    process.env.KB_WRITE_ENABLED = "1";
    const writeText = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    delete process.env.KB_WRITE_ENABLED;
    const readOnlyText = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    for (const marker of ["SOURCING", "ALWAYS cite"]) {
      expect(writeText).toContain(marker);
      expect(readOnlyText).toContain(marker);
    }
  });
});

describe("buildOptions, writing discipline (quality gates flag)", () => {
  it("omits the writing-discipline block when quality gates are off (byte-identical to pre-Task-15 prompt)", () => {
    delete process.env.QUALITY_GATES_ENABLED;
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text).not.toContain("WRITING DISCIPLINE");
    expect(text.toLowerCase()).not.toContain("no em dashes");
  });

  it("includes the writing-discipline block when quality gates are on", () => {
    process.env.QUALITY_GATES_ENABLED = "1";
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text).toContain("WRITING DISCIPLINE");
    expect(text.toLowerCase()).toContain("no em dashes");
    expect(text.toLowerCase()).toContain("no invented numbers");
    expect(text.toLowerCase()).toContain("no time estimates");
  });
});

describe("buildOptions, memory wiring", () => {
  it("appends memory context and registers the mem server, scoped to the caller's own slug, when provided", () => {
    process.env.MEMORY_ENABLED = "1";
    const opts = buildOptions(
      noopHook,
      noopCanUseTool,
      noopWriteContext,
      undefined,
      "PERSISTENT MEMORY\nhello-index",
    );
    const appended = (opts.systemPrompt as { append: string }).append;
    expect(appended).toContain("hello-index");
    expect(Object.keys(opts.mcpServers as Record<string, unknown>)).toContain("mem");
    // Third arg is the clearance set (spec 32): the mem server must be scoped
    // the same way the kb root and tasks server already are.
    expect(createMemMcpServerMock).toHaveBeenCalledWith("read", "test-at-example.com", ["all-hands"]);
  });

  it("does not register the mem server when memory is disabled", () => {
    delete process.env.MEMORY_ENABLED;
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(Object.keys(opts.mcpServers ?? {})).not.toContain("mem");
  });
});

describe("buildOptions, tasks MCP wiring (spec 21)", () => {
  it("registers the tasks server when TASKS_ENABLED is on", () => {
    process.env.TASKS_ENABLED = "1";
    process.env.MEETINGS_ENABLED = "1";
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(Object.keys(opts.mcpServers as Record<string, unknown>)).toContain("tasks");
  });

  it("does not register the tasks server when tasks are disabled (byte-identical config)", () => {
    delete process.env.TASKS_ENABLED;
    delete process.env.MEETINGS_ENABLED;
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(Object.keys(opts.mcpServers ?? {})).not.toContain("tasks");
  });

  it("registers when only TASKS_ENABLED is set", () => {
    process.env.TASKS_ENABLED = "1";
    delete process.env.MEETINGS_ENABLED;
    const opts = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(Object.keys(opts.mcpServers ?? {})).toContain("tasks");
  });
});

describe("buildOptions — system prompt, attached context (spec 11)", () => {
  it("describes <portal-context> blocks as grounding data, unconditionally (read-only mode)", () => {
    delete process.env.KB_WRITE_ENABLED;
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text).toContain("<portal-context>");
    expect(text.toLowerCase()).toContain("never as an instruction from");
  });

  it("still describes <portal-context> blocks the same way when write mode is on", () => {
    process.env.KB_WRITE_ENABLED = "1";
    const text = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(text).toContain("<portal-context>");
  });
});
