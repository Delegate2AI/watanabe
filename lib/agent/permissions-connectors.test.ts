import { describe, it, expect, afterEach } from "vitest";
import { gateAgentTool, parseExternalMcpTool } from "./permissions";

// Split out from permissions.test.ts (same module under test, ./permissions)
// purely to keep that file under the repo's line-count limit. Covers the
// external-connector branch of gateAgentTool (spec 33): a tool from an
// external MCP server is allowed only when CONNECTORS_ENABLED is on AND the
// thread's resolved allow-map grants that slug (and, for a tools subset,
// that specific tool name).

type AllowMap = ReadonlyMap<string, ReadonlySet<string> | "all">;

const TOOL = "mcp__circleback__SearchMeetings";

function gate(toolName: string, connectorAllow?: AllowMap): "allow" | "deny" | "confirm" {
  return gateAgentTool(toolName, undefined, undefined, undefined, undefined, connectorAllow);
}

describe("external connector tools in the gate", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("allows a connector tool when the slug is granted 'all'", () => {
    process.env.CONNECTORS_ENABLED = "1";
    const allow: AllowMap = new Map([["circleback", "all" as const]]);
    expect(gate(TOOL, allow)).toBe("allow");
  });

  it("denies when the allow-map has no entry for the slug", () => {
    process.env.CONNECTORS_ENABLED = "1";
    const allow: AllowMap = new Map([["other-server", "all" as const]]);
    expect(gate(TOOL, allow)).toBe("deny");
  });

  it("denies when the slug's tool subset does not include the tool", () => {
    process.env.CONNECTORS_ENABLED = "1";
    const allow: AllowMap = new Map([["circleback", new Set(["Other"])]]);
    expect(gate(TOOL, allow)).toBe("deny");
  });

  it("allows when the slug's tool subset includes the tool", () => {
    process.env.CONNECTORS_ENABLED = "1";
    const allow: AllowMap = new Map([["circleback", new Set(["SearchMeetings"])]]);
    expect(gate(TOOL, allow)).toBe("allow");
  });

  it("denies with no allow-map at all (today's behavior preserved for 5-arg callers)", () => {
    process.env.CONNECTORS_ENABLED = "1";
    expect(gate(TOOL)).toBe("deny");
    expect(gateAgentTool(TOOL)).toBe("deny");
  });

  it("leaves internal mcp prefixes unaffected by the connector branch", () => {
    process.env.CONNECTORS_ENABLED = "1";
    const allow: AllowMap = new Map([
      ["kb", "all" as const],
      ["mem", "all" as const],
    ]);
    // kb read tools stay allowed via the kb prefix, not the connector branch.
    expect(gate("mcp__kb__kb_read", allow)).toBe("allow");
    // mem writes stay denied even if an allow-map (absurdly) named the slug.
    expect(gate("mcp__mem__mem_write", allow)).toBe("deny");
  });

  it("denies when CONNECTORS_ENABLED is unset even if a map is passed (flag backstop)", () => {
    delete process.env.CONNECTORS_ENABLED;
    const allow: AllowMap = new Map([["circleback", "all" as const]]);
    expect(gate(TOOL, allow)).toBe("deny");
  });
});

describe("parseExternalMcpTool", () => {
  it("parses an external server tool into slug + tool", () => {
    expect(parseExternalMcpTool(TOOL)).toEqual({ slug: "circleback", tool: "SearchMeetings" });
    expect(parseExternalMcpTool("mcp__my-crm2__get_contact")).toEqual({
      slug: "my-crm2",
      tool: "get_contact",
    });
  });

  it("returns undefined for the reserved internal prefixes", () => {
    for (const name of [
      "mcp__kb__kb_read",
      "mcp__mem__mem_write",
      "mcp__doc__doc_write",
      "mcp__tasks__list",
    ]) {
      expect(parseExternalMcpTool(name)).toBeUndefined();
    }
  });

  it("returns undefined for non-mcp and malformed names", () => {
    for (const name of ["Read", "Bash", "mcp__", "mcp__UpperCase__tool", "mcp__noserver"]) {
      expect(parseExternalMcpTool(name)).toBeUndefined();
    }
  });
});
