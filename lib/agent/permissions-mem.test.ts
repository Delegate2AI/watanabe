import { describe, it, expect, afterEach } from "vitest";
import { gateAgentTool } from "./permissions";
import { isMemoryEnabled } from "@/lib/memory/config";

// Split out from permissions.test.ts (same module under test, ./permissions)
// purely to keep that file under the repo's line-count limit. Covers the
// mcp__mem__* branch of gateAgentTool: chat may recall (read) memory when
// enabled, but may never write/delete it directly.

describe("memory read tools in the gate", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("allows mem_read/mem_list only when memory is enabled", () => {
    process.env.MEMORY_ENABLED = "1";
    expect(isMemoryEnabled()).toBe(true);
    expect(gateAgentTool("mcp__mem__mem_read", { path: "memory/shared/x.md" })).toBe("allow");
    expect(gateAgentTool("mcp__mem__mem_list", {})).toBe("allow");
    process.env.MEMORY_ENABLED = "0";
    expect(isMemoryEnabled()).toBe(false);
    expect(gateAgentTool("mcp__mem__mem_read", { path: "memory/shared/x.md" })).toBe("deny");
  });

  it("never allows mem write/delete in chat, even when enabled", () => {
    process.env.MEMORY_ENABLED = "1";
    expect(gateAgentTool("mcp__mem__mem_write", { path: "memory/shared/x.md", content: "x" })).toBe(
      "deny",
    );
    expect(gateAgentTool("mcp__mem__mem_delete", { path: "memory/shared/x.md" })).toBe("deny");
  });
});
