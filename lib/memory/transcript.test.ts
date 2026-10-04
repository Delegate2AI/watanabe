import { describe, expect, it, vi } from "vitest";
import type { Turn } from "@/lib/agent/conversation";

const loadTranscript = vi.fn();

vi.mock("@/lib/agent/transcript", () => ({
  loadTranscript: (...args: unknown[]) => loadTranscript(...args),
}));

const { readTranscriptText } = await import("./transcript");

describe("readTranscriptText", () => {
  it("renders user and assistant turns to plain text", async () => {
    const turns: Turn[] = [
      { id: "u1", role: "user", content: "what is the trader score?" },
      {
        id: "a1",
        role: "assistant",
        status: "done",
        segments: [{ kind: "text", text: "It is defined in 04-economy/score.md." }],
      },
    ];
    loadTranscript.mockResolvedValueOnce(turns);

    const out = await readTranscriptText("s1");
    expect(out).toContain("what is the trader score?");
    expect(out).toContain("04-economy/score.md");
  });

  it("skips tool-only assistant turns and non-text segments", async () => {
    const turns: Turn[] = [
      { id: "u1", role: "user", content: "run the search" },
      {
        id: "a1",
        role: "assistant",
        status: "done",
        segments: [{ kind: "tool", id: "t1", name: "kb_search", input: {}, status: "ok" }],
      },
      {
        id: "a2",
        role: "assistant",
        status: "done",
        segments: [{ kind: "text", text: "Found it." }],
      },
    ];
    loadTranscript.mockResolvedValueOnce(turns);

    const out = await readTranscriptText("s1");
    expect(out).toContain("run the search");
    expect(out).toContain("Found it.");
    expect(out).not.toContain("kb_search");
  });

  it("returns empty string when there are no messages", async () => {
    loadTranscript.mockResolvedValueOnce([]);
    expect(await readTranscriptText("s1")).toBe("");
  });

  it("returns empty string when loadTranscript throws", async () => {
    loadTranscript.mockRejectedValueOnce(new Error("boom"));
    expect(await readTranscriptText("s1")).toBe("");
  });
});
