import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateAgentTool } from "./permissions";

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  process.env.DOC_COPILOT_ENABLED = "1";
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
  delete process.env.DOC_COPILOT_ENABLED;
});

describe("doc copilot MCP permission gate", () => {
  it("allows exactly the three copilot tools when the flag chain is on", () => {
    expect(gateAgentTool("mcp__copilot__copilot_read")).toBe("allow");
    expect(gateAgentTool("mcp__copilot__copilot_review_state")).toBe("allow");
    expect(gateAgentTool("mcp__copilot__copilot_suggest")).toBe("allow");
    expect(gateAgentTool("mcp__copilot__copilot_accept")).toBe("deny");
    expect(gateAgentTool("mcp__copilot__anything_else")).toBe("deny");
  });

  it("denies every copilot tool when any flag in the chain is off", () => {
    delete process.env.DOC_COPILOT_ENABLED;
    expect(gateAgentTool("mcp__copilot__copilot_read")).toBe("deny");
    process.env.DOC_COPILOT_ENABLED = "1";
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    expect(gateAgentTool("mcp__copilot__copilot_suggest")).toBe("deny");
  });
});
