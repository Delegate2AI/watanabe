import { describe, it, expect } from "vitest";
import { applyEvent, type AssistantTurn, type UserTurn } from "./conversation";

const fresh = (): AssistantTurn => ({
  id: "a1",
  role: "assistant",
  segments: [],
  status: "streaming",
});

describe("UserTurn — spec 11 context field", () => {
  it("is optional — a plain user turn with no chips attached is still valid", () => {
    const turn: UserTurn = { id: "u1", role: "user", content: "hello" };
    expect(turn.context).toBeUndefined();
  });

  it("carries chips when attached, without affecting applyEvent's assistant-turn handling", () => {
    const turn: UserTurn = {
      id: "u1",
      role: "user",
      content: "what does this mean?",
      context: [
        {
          path: "a.md",
          headingTrail: ["A"],
          startLine: 1,
          endLine: 2,
          provenance: "verified",
          truncated: false,
        },
      ],
    };
    expect(turn.context).toHaveLength(1);
    // applyEvent only ever operates on AssistantTurn — widening UserTurn must
    // not change its behavior at all.
    const assistant = applyEvent(fresh(), { type: "text_delta", delta: "hi" });
    expect(assistant.segments).toEqual([{ kind: "text", text: "hi" }]);
  });
});

describe("applyEvent — text & thinking", () => {
  it("starts a text segment, then appends to the same one", () => {
    let t = applyEvent(fresh(), { type: "text_delta", delta: "Hel" });
    t = applyEvent(t, { type: "text_delta", delta: "lo" });
    expect(t.segments).toEqual([{ kind: "text", text: "Hello" }]);
  });

  it("opens a NEW text segment when the previous segment is a different kind", () => {
    let t = applyEvent(fresh(), { type: "thinking_delta", delta: "hmm" });
    t = applyEvent(t, { type: "text_delta", delta: "answer" });
    expect(t.segments).toEqual([
      { kind: "thinking", text: "hmm" },
      { kind: "text", text: "answer" },
    ]);
  });

  it("does not mutate the input turn (immutability)", () => {
    const before = fresh();
    const after = applyEvent(before, { type: "text_delta", delta: "x" });
    expect(before.segments).toEqual([]);
    expect(after).not.toBe(before);
  });
});

describe("applyEvent — tools", () => {
  it("adds a running tool pill, then resolves it on its result", () => {
    let t = applyEvent(fresh(), {
      type: "tool_use",
      id: "t1",
      name: "Read",
      input: { file_path: "docs/README.md" },
    });
    expect(t.segments[0]).toMatchObject({ kind: "tool", status: "running" });
    t = applyEvent(t, { type: "tool_result", id: "t1", content: "…", isError: false });
    expect(t.segments[0]).toMatchObject({ status: "ok", result: "…" });
  });

  it("marks a tool errored when its result isError", () => {
    let t = applyEvent(fresh(), { type: "tool_use", id: "t2", name: "x", input: {} });
    t = applyEvent(t, { type: "tool_result", id: "t2", content: "boom", isError: true });
    expect(t.segments[0]).toMatchObject({ status: "error" });
  });

  it("ignores a tool_result whose id matches no pill", () => {
    const t = applyEvent(fresh(), { type: "tool_result", id: "nope", content: "x", isError: false });
    expect(t.segments).toEqual([]);
  });
});

describe("applyEvent — terminal events", () => {
  it("turn_result ok marks done and records cost", () => {
    const t = applyEvent(fresh(), {
      type: "turn_result",
      ok: true,
      costUsd: 0.02,
      sessionCostUsd: 0.05,
      durationMs: 1200,
      result: "done",
    });
    expect(t).toMatchObject({ status: "done", costUsd: 0.02, error: undefined });
  });

  it("turn_result not-ok marks error with the message", () => {
    const t = applyEvent(fresh(), {
      type: "turn_result",
      ok: false,
      costUsd: 0,
      sessionCostUsd: 0,
      durationMs: 10,
      error: "nope",
    });
    expect(t).toMatchObject({ status: "error", error: "nope" });
  });

  it("error event marks the turn errored", () => {
    const t = applyEvent(fresh(), { type: "error", message: "stream died" });
    expect(t).toMatchObject({ status: "error", error: "stream died" });
  });

  it("ignores events it doesn't render (e.g. session/compacted)", () => {
    const t = applyEvent(fresh(), { type: "session", sessionId: "s1" });
    expect(t.segments).toEqual([]);
    expect(t.status).toBe("streaming");
  });
});
