import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A token session gets the staging tools; a cookie session gets the three read
 * tools and nothing else. Registration is the control: a caller who is not
 * privileged never sees a write tool's schema, let alone calls it.
 */

vi.mock("@/lib/kb-mcp/tools", () => ({
  kbList: async () => ({ content: [] }),
  kbRead: async () => ({ content: [] }),
  kbSearch: async () => ({ content: [] }),
  textResult: (text: string) => ({ content: [{ type: "text", text }] }),
  errorResult: (text: string) => ({ content: [{ type: "text", text }], isError: true }),
}));

const sharedDocsEnabled = vi.fn(() => false);
vi.mock("@/lib/shared-docs/config", () => ({ isSharedDocsEnabled: () => sharedDocsEnabled() }));
vi.mock("@/lib/agent/permissions", () => ({ isKbWriteEnabled: () => true }));
const canMock = vi.fn(() => true);
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...(args as [])) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

vi.mock("@/lib/authority/groups", () => ({
  loadGroups: () => ({}),
  resolveClearance: () => ["all-hands"],
}));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => "/vault" }));

const createWriteToolsMock = vi.fn(() => [
  { name: "kb_stage_edit", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
  { name: "kb_stage_delete", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
  { name: "kb_stage_move", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
  { name: "kb_diff", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
  { name: "kb_discard", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
  { name: "kb_submit", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
]);
vi.mock("@/lib/kb-mcp/write-tools", () => ({
  createWriteTools: (...args: unknown[]) => createWriteToolsMock(...(args as [])),
}));

const { buildServer } = await import("./server");

function toolNames(server: unknown): string[] {
  return Object.keys((server as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
}

beforeEach(() => {
  createWriteToolsMock.mockClear();
  sharedDocsEnabled.mockReturnValue(false);
  canMock.mockReset().mockReturnValue(true);
});

describe("tool registration by credential class", () => {
  it("gives a cookie caller exactly the three read tools", () => {
    const server = buildServer("alice@example.com");
    expect(toolNames(server)).toEqual(["kb_list", "kb_read", "kb_search"]);
    expect(createWriteToolsMock).not.toHaveBeenCalled();
  });

  it("gives a token caller the staging tools as well", () => {
    const server = buildServer("alice@example.com", { threadId: "mcp-s1" });
    expect(toolNames(server)).toEqual([
      "kb_diff",
      "kb_discard",
      "kb_list",
      "kb_read",
      "kb_search",
      "kb_stage_delete",
      "kb_stage_edit",
      "kb_stage_move",
      "kb_submit",
    ]);
  });

  it("binds the write tools to this session's own thread, so two clients get two worktrees", () => {
    buildServer("alice@example.com", { threadId: "mcp-s1" });
    buildServer("alice@example.com", { threadId: "mcp-s2" });

    const first = createWriteToolsMock.mock.calls[0][0] as { getThreadId: () => string; ownerEmail: string };
    const second = createWriteToolsMock.mock.calls[1][0] as { getThreadId: () => string };
    expect(first.getThreadId()).toBe("mcp-s1");
    expect(second.getThreadId()).toBe("mcp-s2");
    expect(first.ownerEmail).toBe("alice@example.com");
  });

  // The generated vault map is a chat-orientation aid, and kb_list reaches the
  // same information.
  it("never registers kb_index on this surface", () => {
    const server = buildServer("alice@example.com", { threadId: "mcp-s1" });
    expect(toolNames(server)).not.toContain("kb_index");
  });
});

describe("shared-document tool registration", () => {
  it("adds the three shared-doc tools for a token caller with the flag on", () => {
    sharedDocsEnabled.mockReturnValue(true);
    const server = buildServer("alice@example.com", { threadId: "mcp-s1" });
    expect(toolNames(server)).toEqual(expect.arrayContaining(["shared_doc_create", "shared_doc_update", "shared_doc_attach"]));
  });

  it("registers none of them with the flag off, so the tool set is what it was before", () => {
    const server = buildServer("alice@example.com", { threadId: "mcp-s1" });
    expect(toolNames(server).filter((name) => name.startsWith("shared_doc_"))).toEqual([]);
  });

  it("registers none of them for a cookie caller, however the flag is set", () => {
    sharedDocsEnabled.mockReturnValue(true);
    const server = buildServer("alice@example.com");
    expect(toolNames(server)).toEqual(["kb_list", "kb_read", "kb_search"]);
  });
});
