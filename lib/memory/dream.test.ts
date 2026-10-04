import { describe, expect, it } from "vitest";
import { dreamSystemPrompt, DREAM_TOOLS } from "./dream";

describe("dream prompt", () => {
  it("encodes the memory conventions and the target user", () => {
    const p = dreamSystemPrompt("jane@example.com");
    expect(p).toContain("jane@example.com");
    expect(p).toMatch(/MEMORY\.md/);
    expect(p).toMatch(/frontmatter/i);
    expect(p).toContain("mem_write");
  });
});

describe("dream tool surface", () => {
  /**
   * The dream runs with permissionMode "bypassPermissions" over a transcript
   * that may contain attacker text. `allowedTools` only auto-approves; `tools`
   * is what restricts availability. If a built-in ever reappears here, the mem
   * scope checks become optional and spec 32 is defeated.
   */
  it("exposes only the mem MCP tools, no built-in filesystem or shell tool", () => {
    expect([...DREAM_TOOLS]).toEqual([
      "mcp__mem__mem_list",
      "mcp__mem__mem_read",
      "mcp__mem__mem_write",
      "mcp__mem__mem_delete",
    ]);
    for (const forbidden of ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]) {
      expect(DREAM_TOOLS as readonly string[]).not.toContain(forbidden);
    }
  });
});

describe("dream prompt clearance scoping", () => {
  it("lists only the groups the owner is cleared to write", () => {
    const p = dreamSystemPrompt("jane@example.com", ["all-hands", "finance"]);
    expect(p).toContain("memory/shared/all-hands/");
    expect(p).toContain("memory/shared/finance/");
    expect(p).not.toContain("memory/shared/legal/");
  });

  it("tells a user with no group clearance to write private memory only", () => {
    const p = dreamSystemPrompt("jane@example.com", []);
    expect(p).toMatch(/no shared-group clearance/i);
    expect(p).not.toContain("memory/shared/");
  });

  it("instructs narrowest-group placement, the downgrade guidance the tool layer cannot enforce", () => {
    expect(dreamSystemPrompt("jane@example.com", ["all-hands", "finance"])).toMatch(/narrowest/i);
  });
});
