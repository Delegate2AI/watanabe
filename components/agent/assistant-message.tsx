"use client";

import { memo } from "react";
import { Bot, AlertTriangle } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { ToolPill } from "./tool-pill";
import type { AssistantTurn } from "@/lib/agent/conversation";

/**
 * Memoized on `turn`: the transcript re-renders on every batch of streamed
 * tokens, and `applyEvent` leaves every settled turn referentially identical, so
 * only the turn actually being written repeats its work.
 */
export const AssistantMessage = memo(function AssistantMessage({
  turn,
}: {
  turn: AssistantTurn;
}) {
  // A completed turn with nothing visible shouldn't render an empty bubble.
  if (turn.status === "done" && turn.segments.length === 0) return null;
  // A STREAMING turn with nothing visible YET doesn't render either — the
  // chat shows one explicit thinking row for that phase (spec 15 D35, see
  // AgentChat's ThinkingIndicator) instead of a bot icon with a
  // barely-visible cursor that reads as "stuck".
  if (turn.status === "streaming" && turn.segments.length === 0) return null;

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {turn.segments.map((seg, i) => {
          if (seg.kind === "tool") return <ToolPill key={seg.id || i} tool={seg} />;
          if (seg.kind === "thinking") {
            return (
              <details key={i} className="my-1 text-xs text-[var(--color-ink-faint)]">
                <summary className="cursor-pointer select-none italic">thinking…</summary>
                <div className="mt-1 whitespace-pre-wrap border-l-2 border-[var(--color-line)] pl-3">
                  {seg.text}
                </div>
              </details>
            );
          }
          return (
            <div key={i} className="text-sm leading-relaxed text-[var(--color-ink)]">
              <Markdown>{seg.text}</Markdown>
            </div>
          );
        })}

        {turn.status === "streaming" && (
          <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-[var(--color-ink-muted)] align-middle" />
        )}

        {turn.status === "error" && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{turn.error || "The assistant failed."}</span>
          </div>
        )}
        {/* Per-turn USD cost is deliberately NOT shown here: it is operator
            telemetry (the server logs it per turn), not something an end user
            reading a KB answer should see. The main chat never showed it, so the
            embedded KB assistant no longer does either. */}
      </div>
    </div>
  );
});
