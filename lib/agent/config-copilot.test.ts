import { describe, it, expect, afterEach } from "vitest";
import type { HookJSONOutput, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";
import type { DocBinding } from "./copilot-prompt";

// Spec 2026-08-27: a doc-bound session gets the copilot preamble and the
// `copilot` MCP server. Both are dormant (byte-identical options) unless the
// flag chain is on AND a binding is passed, and neither couples to
// PROJECTS_ENABLED.

const noopHook = async (): Promise<HookJSONOutput> => ({});
const noopCanUseTool = async (): Promise<PermissionResult> => ({ behavior: "allow" });
const noopWriteContext: KbWriteContext = { getThreadId: () => "test-thread", ownerEmail: "test@example.com" };

const BINDING: DocBinding = { docId: "11111111-1111-1111-1111-111111111111", docTitle: "Pricing Plan", access: "comment" };

const { buildOptions } = await import("./config");

function systemPromptText(opts: ReturnType<typeof buildOptions>): string {
  const prompt = opts.systemPrompt as { type: "preset"; preset: "claude_code"; append?: string };
  return prompt.append ?? "";
}

function withFlagsOn(): void {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  process.env.DOC_COPILOT_ENABLED = "1";
}

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
  delete process.env.DOC_COPILOT_ENABLED;
});

describe("buildOptions: doc binding (spec 2026-08-27)", () => {
  it("appends the copilot contract and registers the copilot server when bound and enabled", () => {
    withFlagsOn();
    const opts = buildOptions(
      noopHook, noopCanUseTool, noopWriteContext,
      undefined, undefined, ["all-hands"], null, undefined, undefined, undefined,
      BINDING,
    );
    const text = systemPromptText(opts);
    expect(text).toContain('"Pricing Plan"');
    expect(text).toContain("copilot_suggest");
    expect(text).toContain("comment access");
    expect(Object.keys(opts.mcpServers ?? {})).toContain("copilot");
  });

  it("is byte-identical to the unbound call when the flag chain is off", () => {
    const bound = buildOptions(
      noopHook, noopCanUseTool, noopWriteContext,
      undefined, undefined, ["all-hands"], null, undefined, undefined, undefined,
      BINDING,
    );
    const unbound = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(systemPromptText(bound)).toBe(systemPromptText(unbound));
    expect(Object.keys(bound.mcpServers ?? {})).toEqual(Object.keys(unbound.mcpServers ?? {}));
  });

  it("adds nothing for an enabled but unbound session", () => {
    withFlagsOn();
    const unbound = buildOptions(noopHook, noopCanUseTool, noopWriteContext);
    expect(systemPromptText(unbound)).not.toContain("copilot_suggest");
    expect(Object.keys(unbound.mcpServers ?? {})).not.toContain("copilot");
  });

  it("does not depend on PROJECTS_ENABLED", () => {
    withFlagsOn();
    delete process.env.PROJECTS_ENABLED;
    const opts = buildOptions(
      noopHook, noopCanUseTool, noopWriteContext,
      undefined, undefined, ["all-hands"], null, undefined, undefined, undefined,
      BINDING,
    );
    expect(systemPromptText(opts)).toContain("copilot_suggest");
  });
});
