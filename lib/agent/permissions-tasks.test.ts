import { afterEach, describe, expect, it } from "vitest";
import { gateAgentTool } from "./permissions";

afterEach(() => {
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
});

describe("task MCP permission gate", () => {
  it("allows only the read-only task list tool when tasks are enabled", () => {
    process.env.TASKS_ENABLED = "1";
    process.env.MEETINGS_ENABLED = "1";
    expect(gateAgentTool("mcp__tasks__list")).toBe("allow");
    expect(gateAgentTool("mcp__tasks__accept")).toBe("deny");
    expect(gateAgentTool("mcp__tasks__complete")).toBe("deny");
    expect(gateAgentTool("mcp__tasks__anything_else")).toBe("deny");
  });

  it("gates the list tool only on TASKS_ENABLED", () => {
    expect(gateAgentTool("mcp__tasks__list")).toBe("deny");
    process.env.TASKS_ENABLED = "1";
    expect(gateAgentTool("mcp__tasks__list")).toBe("allow");
  });
});
