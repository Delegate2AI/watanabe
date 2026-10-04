import { describe, it, expect } from "vitest";
import type { AssistantTurn, Turn } from "@/lib/agent/conversation";
import { COPILOT_SUGGEST_TOOL, parseCopilotSuggestResult, suggestionsInTurn, suggestionCount } from "./copilot-derive";

const REF = { suggestionId: "s1", baseVersion: 2 };

function suggestTurn(result: unknown, status: "ok" | "error" = "ok"): AssistantTurn {
  return {
    id: "a1",
    role: "assistant",
    status: "done",
    segments: [
      { kind: "text", text: "Done." },
      { kind: "tool", id: "t1", name: COPILOT_SUGGEST_TOOL, input: {}, status, result },
    ],
  } as AssistantTurn;
}

describe("parseCopilotSuggestResult", () => {
  it("unwraps the MCP content array and a bare JSON string", () => {
    expect(parseCopilotSuggestResult([{ type: "text", text: JSON.stringify(REF) }])).toEqual(REF);
    expect(parseCopilotSuggestResult(JSON.stringify(REF))).toEqual(REF);
  });

  it("returns null for refusal text and malformed shapes", () => {
    expect(parseCopilotSuggestResult([{ type: "text", text: "The quote appears 2 times." }])).toBeNull();
    expect(parseCopilotSuggestResult(JSON.stringify({ suggestionId: 1 }))).toBeNull();
    expect(parseCopilotSuggestResult(undefined)).toBeNull();
  });
});

describe("suggestionsInTurn / suggestionCount", () => {
  it("collects only successful copilot_suggest segments", () => {
    expect(suggestionsInTurn(suggestTurn([{ type: "text", text: JSON.stringify(REF) }]))).toEqual([REF]);
    expect(suggestionsInTurn(suggestTurn("refused", "error"))).toEqual([]);
  });

  it("counts across the transcript, skipping user turns", () => {
    const turns: Turn[] = [
      { id: "u1", role: "user", content: "fix it" },
      suggestTurn([{ type: "text", text: JSON.stringify(REF) }]),
    ];
    expect(suggestionCount(turns)).toBe(1);
  });
});
