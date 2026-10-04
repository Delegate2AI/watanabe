"use client";

import { Bot } from "lucide-react";

/**
 * The in-transcript "agent is working" row (spec 15 D35), styled as an
 * assistant message (same avatar/row layout as AssistantMessage) so the
 * user's just-sent message visibly got a response slot. `label` surfaces the
 * live `status` event text when there is one ("Checking submission
 * quality…"), else a generic "Thinking…".
 */
export function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-accent-fg)]">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 pt-1.5">
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-ink-muted)]"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="text-xs text-[var(--color-ink-faint)]">{label}</span>
      </div>
    </div>
  );
}
