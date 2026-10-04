import { describe, it, expect } from "vitest";
import { createKbReadOnlyMcpServer, kbReadOnlyTools } from "./read-tools";

function registeredToolNames(server: ReturnType<typeof createKbReadOnlyMcpServer>): string[] {
  const instance = server.instance as unknown as { _registeredTools: Record<string, unknown> };
  return Object.keys(instance._registeredTools);
}

describe("kbReadOnlyTools", () => {
  it("returns exactly the three read-only tool definitions", () => {
    const names = kbReadOnlyTools().map((t) => t.name);
    expect(names.sort()).toEqual(["kb_list", "kb_read", "kb_search"]);
  });
});

describe("createKbReadOnlyMcpServer", () => {
  it("registers exactly the three read-only tools, no write tools, no kb_index", () => {
    const names = registeredToolNames(createKbReadOnlyMcpServer());
    expect(names.sort()).toEqual(["kb_list", "kb_read", "kb_search"]);
  });
});
