import { describe, it, expect, afterEach } from "vitest";
import type { HookJSONOutput, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";

// Spec 26: a project thread's context is appended to the system prompt (after
// KB governance, before memory). It is instructions only: it must not change
// the clearance-derived vault root, and it must be dormant (byte-identical)
// unless PROJECTS_ENABLED is on.

const noopHook = async (): Promise<HookJSONOutput> => ({});
const noopCanUseTool = async (): Promise<PermissionResult> => ({ behavior: "allow" });
const noopWriteContext: KbWriteContext = { getThreadId: () => "test-thread", ownerEmail: "test@example.com" };

const { buildOptions } = await import("./config");

function systemPromptText(opts: ReturnType<typeof buildOptions>): string {
  const prompt = opts.systemPrompt as { type: "preset"; preset: "claude_code"; append?: string };
  return prompt.append ?? "";
}

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
});

describe("buildOptions: project context (spec 26)", () => {
  it("appends the project context after governance and before memory when enabled", () => {
    process.env.PROJECTS_ENABLED = "1";
    const text = systemPromptText(
      buildOptions(
        noopHook,
        noopCanUseTool,
        noopWriteContext,
        undefined,
        "PERSISTENT MEMORY\nmem-marker",
        ["all-hands"],
        null,
        "PROJECT: cite the launch brief",
      ),
    );
    expect(text).toContain("PROJECT: cite the launch brief");
    // Ordering: governance (SOURCING) -> project -> memory.
    expect(text.indexOf("SOURCING")).toBeLessThan(text.indexOf("PROJECT: cite the launch brief"));
    expect(text.indexOf("PROJECT: cite the launch brief")).toBeLessThan(text.indexOf("mem-marker"));
  });

  it("does not append the project context when PROJECTS_ENABLED is off (byte-identical)", () => {
    delete process.env.PROJECTS_ENABLED;
    const withContext = systemPromptText(
      buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], null, "PROJECT: x"),
    );
    const without = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(withContext).toBe(without);
    expect(withContext).not.toContain("PROJECT: x");
  });

  it("is a no-op for a project with empty context, even when enabled", () => {
    process.env.PROJECTS_ENABLED = "1";
    const withEmpty = systemPromptText(
      buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], null, "   "),
    );
    delete process.env.PROJECTS_ENABLED;
    const without = systemPromptText(buildOptions(noopHook, noopCanUseTool, noopWriteContext));
    expect(withEmpty).toBe(without);
  });

  it("does not change the clearance-derived cwd root (context is instructions only)", () => {
    process.env.PROJECTS_ENABLED = "1";
    const withContext = buildOptions(
      noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], null, "PROJECT: x",
    );
    const without = buildOptions(noopHook, noopCanUseTool, noopWriteContext, undefined, undefined, ["all-hands"], null);
    expect(withContext.cwd).toBe(without.cwd);
  });
});
