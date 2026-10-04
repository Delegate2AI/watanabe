import { describe, it, expect } from "vitest";
import type { AssistantTurn, Turn } from "@/lib/agent/conversation";
import { docsInTurn, activeDocId, parseDocWriteResult } from "./derive";

function toolSegment(result: unknown, status: "running" | "ok" | "error" = "ok") {
  return {
    kind: "tool" as const,
    id: "t1",
    name: "mcp__doc__doc_write",
    input: { title: "Memo", body: "..." },
    status,
    result,
  };
}

function assistant(segments: AssistantTurn["segments"], id = "a1"): AssistantTurn {
  return { id, role: "assistant", segments, status: "done" };
}

const okResult = [{ type: "text", text: JSON.stringify({ docId: "d1", version: 2, title: "Memo" }) }];

describe("parseDocWriteResult", () => {
  it("parses the MCP text content array", () => {
    expect(parseDocWriteResult(okResult)).toEqual({ docId: "d1", version: 2, title: "Memo" });
  });

  it("parses a bare JSON string result", () => {
    expect(parseDocWriteResult(JSON.stringify({ docId: "d9", version: 1, title: "X" }))).toEqual({
      docId: "d9",
      version: 1,
      title: "X",
    });
  });

  it("returns null for a non-doc result", () => {
    expect(parseDocWriteResult([{ type: "text", text: "not json" }])).toBeNull();
    expect(parseDocWriteResult(undefined)).toBeNull();
  });
});

describe("docsInTurn", () => {
  it("returns the parsed doc for each successful doc_write segment", () => {
    const turn = assistant([toolSegment(okResult)]);
    expect(docsInTurn(turn)).toEqual([{ docId: "d1", version: 2, title: "Memo" }]);
  });

  it("ignores non-doc tools, errored, and still-running doc_write calls", () => {
    const turn = assistant([
      { kind: "tool", id: "k", name: "mcp__kb__kb_read", input: {}, status: "ok", result: "x" },
      toolSegment(okResult, "error"),
      toolSegment(okResult, "running"),
    ]);
    expect(docsInTurn(turn)).toEqual([]);
  });
});

describe("activeDocId", () => {
  it("is the docId of the most recent doc_write across the transcript", () => {
    const turns: Turn[] = [
      { id: "u1", role: "user", content: "hi" },
      assistant([toolSegment([{ type: "text", text: JSON.stringify({ docId: "d1", version: 1, title: "A" }) }])], "a1"),
      assistant([toolSegment([{ type: "text", text: JSON.stringify({ docId: "d2", version: 1, title: "B" }) }])], "a2"),
    ];
    expect(activeDocId(turns)).toBe("d2");
  });

  it("is null when no doc was written", () => {
    expect(activeDocId([{ id: "u1", role: "user", content: "hi" }])).toBeNull();
  });
});
