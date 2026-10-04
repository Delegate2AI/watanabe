"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { applyEvent, type Turn } from "@/lib/agent/conversation";
import type { AgentEvent } from "@/lib/agent/events";

/**
 * The event types worth coalescing: the two that arrive token by token. Every
 * other event (tool_use, tool_result, turn_result, error) arrives a handful of
 * times per turn, so deferring one buys nothing and delaying a completion or an
 * error by a frame is a visible lie about what the agent is doing.
 */
const COALESCED: ReadonlySet<AgentEvent["type"]> = new Set(["text_delta", "thinking_delta"]);

/** One queued event and the assistant turn it belongs to. */
interface Pending {
  id: string;
  event: AgentEvent;
}

/**
 * Schedule on the next frame, falling back to a timer where there is no frame
 * loop (a background tab throttles rAF to a stop, and not every test DOM
 * provides one). The fallback interval is one frame at 60Hz.
 */
function schedule(fn: () => void): ReturnType<typeof setTimeout> | number {
  return typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);
}

function unschedule(handle: ReturnType<typeof setTimeout> | number): void {
  if (typeof cancelAnimationFrame === "function" && typeof handle === "number") {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

/**
 * Folds stream events into the transcript at most once per animation frame.
 *
 * A fast model emits tokens well above 60/s, and the naive reducer called
 * `setTurns` on every one: each token re-rendered the whole transcript, re-ran
 * the markdown pipeline for the turn being written, and made the stick-to-bottom
 * effect force a synchronous layout. None of that work is visible, because the
 * browser paints once per frame regardless.
 *
 * So text and thinking deltas queue up and land together on the next frame,
 * while every other event applies immediately (after flushing whatever text is
 * queued ahead of it, so ordering is never disturbed). The queued events for one
 * turn are folded in a single `setTurns` pass, and turns not named in the queue
 * come out referentially identical, which is what lets the memo boundaries in
 * `TranscriptTurn` skip them.
 *
 * Callers must `flush()` when a stream ends so nothing is left sitting in the
 * queue behind a frame that may never come.
 */
export function useTurnPatch(setTurns: Dispatch<SetStateAction<Turn[]>>) {
  const queueRef = useRef<Pending[]>([]);
  const frameRef = useRef<ReturnType<typeof setTimeout> | number | null>(null);

  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      unschedule(frameRef.current);
      frameRef.current = null;
    }
    const pending = queueRef.current;
    if (pending.length === 0) return;
    queueRef.current = [];
    setTurns((prev) =>
      prev.map((turn) => {
        if (turn.role !== "assistant") return turn;
        let next = turn;
        for (const p of pending) if (p.id === turn.id) next = applyEvent(next, p.event);
        return next;
      }),
    );
  }, [setTurns]);

  const patch = useCallback(
    (id: string, event: AgentEvent) => {
      queueRef.current.push({ id, event });
      if (!COALESCED.has(event.type)) {
        flush();
        return;
      }
      if (frameRef.current === null) {
        frameRef.current = schedule(() => {
          frameRef.current = null;
          flush();
        });
      }
    },
    [flush],
  );

  // A queued frame holds a closure over state this component no longer owns.
  useEffect(
    () => () => {
      if (frameRef.current !== null) unschedule(frameRef.current);
    },
    [],
  );

  return { patch, flush };
}
