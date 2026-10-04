import { describe, it, expect, afterEach } from "vitest";
import { createKbMcpServer } from "./server";

// `createSdkMcpServer` doesn't expose a public "list registered tools" API,
// so these read the underlying `@modelcontextprotocol/sdk` McpServer's
// private `_registeredTools` map directly — a pragmatic, test-only
// introspection of a third-party internal, not something production code
// ever does. What matters for the write-path's safety story is asserted here
// at the REGISTRATION level: a write tool that was never registered is one
// the model can never even attempt to call, independent of the PreToolUse
// gate (lib/agent/permissions.ts) that would also deny it.

const context = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com" };

function registeredToolNames(server: ReturnType<typeof createKbMcpServer>): string[] {
  const instance = server.instance as unknown as { _registeredTools: Record<string, unknown> };
  return Object.keys(instance._registeredTools);
}

afterEach(() => {
  delete process.env.KB_WRITE_ENABLED;
  delete process.env.INDEX_ENABLED;
});

describe("createKbMcpServer — conditional write-tool registration", () => {
  it("registers only the three read tools when KB_WRITE_ENABLED is unset", () => {
    delete process.env.KB_WRITE_ENABLED;
    const names = registeredToolNames(createKbMcpServer(context));
    expect(names.sort()).toEqual(["kb_list", "kb_read", "kb_search"]);
  });

  it("also registers the write tools when KB_WRITE_ENABLED=1", () => {
    process.env.KB_WRITE_ENABLED = "1";
    const names = registeredToolNames(createKbMcpServer(context));
    expect(names.sort()).toEqual(
      [
        "kb_check",
        "kb_diff",
        "kb_discard",
        "kb_list",
        "kb_read",
        "kb_search",
        "kb_stage_delete",
        "kb_stage_edit",
        "kb_stage_move",
        "kb_submit",
      ].sort(),
    );
  });
});

describe("createKbMcpServer: conditional kb_index registration", () => {
  it("does not register kb_index when INDEX_ENABLED is unset", () => {
    delete process.env.INDEX_ENABLED;
    const names = registeredToolNames(createKbMcpServer(context));
    expect(names).not.toContain("kb_index");
  });

  it("also registers kb_index when INDEX_ENABLED=1", () => {
    process.env.INDEX_ENABLED = "1";
    const names = registeredToolNames(createKbMcpServer(context));
    expect(names.sort()).toEqual(["kb_index", "kb_list", "kb_read", "kb_search"]);
  });
});
