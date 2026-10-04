import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The HTTP MCP surface reads the vault at the CALLER's clearance.
 *
 * It authenticated the caller and then read as `all-hands`, because the tools
 * were called with no `scopeRoot` and fell back to `vaultRoot()`. Narrower than
 * it should be rather than wider, so never a leak, but an admin saw only
 * all-hands content through their own client.
 */

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const kbListMock = vi.fn(async () => ({ content: [{ type: "text" as const, text: "listed" }] }));
const kbReadMock = vi.fn(async () => ({ content: [{ type: "text" as const, text: "read" }] }));
const kbSearchMock = vi.fn(async () => ({ content: [{ type: "text" as const, text: "found" }] }));
vi.mock("@/lib/kb-mcp/tools", () => ({
  kbList: (...args: unknown[]) => kbListMock(...(args as [])),
  kbRead: (...args: unknown[]) => kbReadMock(...(args as [])),
  kbSearch: (...args: unknown[]) => kbSearchMock(...(args as [])),
}));

const clearanceCalls: string[] = [];
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({ admins: ["alice@example.com"], marketing: ["bob@example.com"] }),
  resolveClearance: (email: string) => {
    clearanceCalls.push(email);
    return email === "alice@example.com" ? ["all-hands", "admins"] : ["all-hands", "marketing"];
  },
}));

vi.mock("@/lib/repo", () => ({
  vaultRootFor: (clearance: string[]) => `/vault/${[...clearance].sort().join("+")}`,
}));

const { buildServer } = await import("./server");

const { sessionOwnerMatches } = await import("./auth");

beforeEach(() => {
  requireIdentityMock.mockReset();
  kbListMock.mockClear();
  kbReadMock.mockClear();
  kbSearchMock.mockClear();
  clearanceCalls.length = 0;
});

/**
 * An `Mcp-Session-Id` is a bearer of the projection its owner had. Reusing one
 * for a different caller would hand them that owner's vault view.
 */
describe("a session belongs to the identity that opened it", () => {
  it("matches its own owner and rejects anyone else", () => {
    expect(sessionOwnerMatches("alice@example.com", "alice@example.com")).toBe(true);
    expect(sessionOwnerMatches("alice@example.com", "bob@example.com")).toBe(false);
  });

  it("compares case-insensitively, since the same person can arrive either way", () => {
    expect(sessionOwnerMatches("alice@example.com", "Alice@Example.com ")).toBe(true);
  });
});

/** Drive a registered tool without standing up the whole MCP transport. */
async function callTool(server: unknown, name: string, args: Record<string, unknown>) {
  const registered = (server as { _registeredTools: Record<string, { handler: (a: unknown) => unknown }> })
    ._registeredTools[name];
  expect(registered, `tool ${name} is not registered`).toBeDefined();
  return registered.handler(args);
}

describe("the HTTP MCP server reads at the caller's clearance", () => {
  it("passes the caller's own vault projection to every read tool", async () => {
    const server = buildServer("alice@example.com");

    await callTool(server, "kb_list", { path: "." });
    await callTool(server, "kb_read", { path: "a.md" });
    await callTool(server, "kb_search", { query: "x" });

    expect(kbListMock.mock.calls[0][1]).toBe("/vault/admins+all-hands");
    expect(kbReadMock.mock.calls[0][1]).toBe("/vault/admins+all-hands");
    expect(kbSearchMock.mock.calls[0][1]).toBe("/vault/admins+all-hands");
  });

  // A session outlives a single request, and group membership can change while
  // it is open. Resolving at build time would keep serving the projection the
  // caller had when they connected.
  it("resolves the projection per call, not once when the session is built", async () => {
    const server = buildServer("alice@example.com");
    await callTool(server, "kb_list", {});
    clearanceCalls.length = 0;
    await callTool(server, "kb_list", {});
    expect(clearanceCalls).toEqual(["alice@example.com"]);
  });

  it("gives two callers two different roots, not one shared all-hands root", async () => {
    await callTool(buildServer("alice@example.com"), "kb_list", {});
    await callTool(buildServer("bob@example.com"), "kb_list", {});

    expect(kbListMock.mock.calls[0][1]).toBe("/vault/admins+all-hands");
    expect(kbListMock.mock.calls[1][1]).toBe("/vault/all-hands+marketing");
  });
});
