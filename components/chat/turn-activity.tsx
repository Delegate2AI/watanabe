"use client";

import { useEffect, useState } from "react";
import type { AssistantTurn, ToolSegment } from "@/lib/agent/conversation";

/**
 * What a running agent turn is doing right now.
 *
 * Replaces a static "Working…" that sat unchanged for minutes: a turn was
 * measured at over three and a half minutes with no streamed text, no trace, and
 * no elapsed time. Raw model latency is not a defect, but a UI that reports
 * nothing for minutes is one regardless of speed.
 *
 * Two signals, both cheap: the tool the agent is currently running, named in
 * plain language, and an elapsed counter that appears only once the turn has run
 * past ten seconds. Below ten seconds a timer is noise; above it, it is the
 * difference between "slow" and "hung".
 */

/** Wait this long before a turn is slow enough to be worth timing. */
const SHOW_ELAPSED_AFTER_MS = 10_000;

/**
 * Plain-language copy per tool. Keyed on the bare tool name, after the
 * `mcp__<server>__` prefix is stripped. A tool with no entry falls back to the
 * neutral label rather than rendering its own identifier: an internal tool name
 * is exactly the kind of string this contract exists to keep off the screen.
 */
const TOOL_LABELS: Record<string, string> = {
  kb_search: "Searching the knowledge base",
  kb_read: "Reading the knowledge base",
  kb_stage: "Preparing a change",
  kb_submit: "Preparing a change",
  kb_discard: "Discarding a draft",
  doc_write: "Writing a document",
  doc_read: "Reading a document",
  WebSearch: "Searching the web",
  WebFetch: "Reading a web page",
  Read: "Reading a file",
  Grep: "Searching files",
  Glob: "Looking for files",
};

/** Neutral copy for "the agent is busy and we cannot say more than that". */
const NEUTRAL = "Working";

function toolSegments(turn: AssistantTurn): ToolSegment[] {
  return turn.segments.filter((s): s is ToolSegment => s.kind === "tool");
}

function labelFor(name: string): string {
  return TOOL_LABELS[name.replace(/^mcp__[^_]+__/, "")] ?? NEUTRAL;
}

/**
 * The one-line description of where this turn currently is: the most recent
 * running tool if there is one, "Thinking" if its tools have all returned and
 * the model has the floor, and the neutral label before anything has happened.
 */
export function activityLabel(turn: AssistantTurn): string {
  const tools = toolSegments(turn);
  const running = tools.filter((s) => s.status === "running").at(-1);
  if (running) return labelFor(running.name);
  return tools.length > 0 ? "Thinking" : NEUTRAL;
}

/** Milliseconds since mount, re-read once a second. */
function useElapsedMs(): number {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now - startedAt;
}

/** "42s" under a minute, "3m 35s" above it. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function TurnActivity({ turn }: { turn: AssistantTurn }) {
  const elapsed = useElapsedMs();
  return (
    <p className="flex items-center gap-2 text-ink-faint" aria-label="Working" aria-live="polite">
      <span className="animate-pulse">{activityLabel(turn)}</span>
      {elapsed >= SHOW_ELAPSED_AFTER_MS && (
        <span className="text-xs tabular-nums text-ink-faint">{formatElapsed(elapsed)}</span>
      )}
    </p>
  );
}
