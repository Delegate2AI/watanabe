import { describe, it, expect } from "vitest";
import { sourceRefs } from "./tool-cards";
import type { AssistantTurn } from "@/lib/agent/conversation";

function turn(segments: AssistantTurn["segments"]): AssistantTurn {
  return { id: "a1", role: "assistant", segments, status: "done" };
}

describe("sourceRefs", () => {
  it("extracts a kb_read citation with its path and reported visibility", () => {
    const refs = sourceRefs(
      turn([
        { kind: "text", text: "answer" },
        {
          kind: "tool",
          id: "t1",
          name: "mcp__kb__kb_read",
          input: { path: "docs/orbit/payouts.md" },
          status: "ok",
          result: { visibility: "exec" },
        },
      ]),
    );
    expect(refs).toEqual([{ path: "docs/orbit/payouts.md", visibility: "exec" }]);
  });

  it("does NOT cite a kb_search query as if it were a document", () => {
    // The search query is not a path. Citing it rendered a card labelled with
    // the user's own search words ("Phase 4"), which opened to "This document
    // is not available (it may be restricted or moved)" because no such file
    // exists. The documents the search led to are cited by their own kb_read.
    const refs = sourceRefs(
      turn([
        { kind: "tool", id: "t1", name: "mcp__kb__kb_search", input: { query: "Phase 4" }, status: "ok" },
        {
          kind: "tool",
          id: "t2",
          name: "mcp__kb__kb_read",
          input: { path: "product/MERIDIAN_Strategic_Plan_v1_2.md" },
          status: "ok",
        },
      ]),
    );
    expect(refs).toEqual([
      { path: "product/MERIDIAN_Strategic_Plan_v1_2.md", visibility: undefined },
    ]);
  });

  it("does NOT cite kb_search's optional scope path, which is a directory to search, not a source", () => {
    const refs = sourceRefs(
      turn([
        {
          kind: "tool",
          id: "t1",
          name: "mcp__kb__kb_search",
          input: { query: "payouts", path: "product" },
          status: "ok",
        },
      ]),
    );
    expect(refs).toEqual([]);
  });

  it("ignores non-KB tools and collapses duplicate paths", () => {
    const refs = sourceRefs(
      turn([
        { kind: "tool", id: "t1", name: "Read", input: { path: "x" }, status: "ok" },
        { kind: "tool", id: "t2", name: "kb_read", input: { path: "docs/a.md" }, status: "ok" },
        { kind: "tool", id: "t3", name: "kb_read", input: { path: "docs/a.md" }, status: "ok" },
      ]),
    );
    expect(refs).toEqual([{ path: "docs/a.md", visibility: undefined }]);
  });
});
