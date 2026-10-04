// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { Turn } from "@/lib/agent/conversation";
import { useTurnPatch } from "./use-turn-patch";

/** A hook under test wired to real transcript state, as the chat surfaces use it. */
function usePatchedTurns(initial: Turn[]) {
  const [turns, setTurns] = useState<Turn[]>(initial);
  const { patch, flush } = useTurnPatch(setTurns);
  return { turns, patch, flush };
}

const STREAMING: Turn[] = [
  { id: "settled", role: "assistant", segments: [{ kind: "text", text: "old" }], status: "done" },
  { id: "live", role: "assistant", segments: [], status: "streaming" },
];

/** The concatenated text of one assistant turn. */
function textOf(turns: Turn[], id: string): string {
  const turn = turns.find((t) => t.id === id);
  if (!turn || turn.role !== "assistant") return "";
  return turn.segments.map((s) => (s.kind === "text" ? s.text : "")).join("");
}

describe("useTurnPatch", () => {
  it("holds token deltas back from state until the frame lands", async () => {
    const { result } = renderHook(() => usePatchedTurns(STREAMING));

    act(() => {
      result.current.patch("live", { type: "text_delta", delta: "one " });
      result.current.patch("live", { type: "text_delta", delta: "two" });
    });
    // Still queued: a token must not mean a transcript render of its own.
    expect(textOf(result.current.turns, "live")).toBe("");

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(textOf(result.current.turns, "live")).toBe("one two");
  });

  it("applies a non-delta event immediately, behind whatever text is queued", () => {
    const { result } = renderHook(() => usePatchedTurns(STREAMING));

    act(() => {
      result.current.patch("live", { type: "text_delta", delta: "the answer" });
      result.current.patch("live", {
        type: "turn_result",
        ok: true,
        costUsd: 0,
        sessionCostUsd: 0,
        durationMs: 1,
      });
    });

    // Completion is not deferred, and the text queued ahead of it is not lost
    // or reordered behind it.
    const live = result.current.turns.find((t) => t.id === "live");
    expect(live && live.role === "assistant" && live.status).toBe("done");
    expect(textOf(result.current.turns, "live")).toBe("the answer");
  });

  it("flush() lands queued text when no further event will arrive", () => {
    const { result } = renderHook(() => usePatchedTurns(STREAMING));

    act(() => {
      result.current.patch("live", { type: "text_delta", delta: "interrupted mid-" });
      result.current.flush();
    });
    expect(textOf(result.current.turns, "live")).toBe("interrupted mid-");
  });

  it("leaves settled turns referentially identical, so their memo boundaries hold", () => {
    const { result } = renderHook(() => usePatchedTurns(STREAMING));
    const before = result.current.turns.find((t) => t.id === "settled");

    act(() => {
      result.current.patch("live", { type: "text_delta", delta: "x" });
      result.current.flush();
    });

    expect(result.current.turns.find((t) => t.id === "settled")).toBe(before);
  });

  it("does not run a queued frame after unmount", () => {
    const { result, unmount } = renderHook(() => usePatchedTurns(STREAMING));
    const spy = vi.spyOn(console, "error");

    act(() => {
      result.current.patch("live", { type: "text_delta", delta: "orphan" });
    });
    unmount();

    // No "update on an unmounted component" warning from a frame that outlived
    // the surface it was going to write to.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
