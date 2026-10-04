import { afterEach, describe, expect, it } from "vitest";
import { gateAgentTool } from "./permissions";

afterEach(() => {
  delete process.env.CANVAS_ENABLED;
});

describe("canvas doc MCP permission gate", () => {
  it("allows only doc_write, and only when CANVAS_ENABLED is on", () => {
    process.env.CANVAS_ENABLED = "1";
    expect(gateAgentTool("mcp__doc__doc_write")).toBe("allow");
    expect(gateAgentTool("mcp__doc__doc_delete")).toBe("deny");
    expect(gateAgentTool("mcp__doc__anything_else")).toBe("deny");
  });

  it("denies doc_write when the flag is off (byte-identical, tool unreachable)", () => {
    expect(gateAgentTool("mcp__doc__doc_write")).toBe("deny");
    process.env.CANVAS_ENABLED = "0";
    expect(gateAgentTool("mcp__doc__doc_write")).toBe("deny");
  });
});
