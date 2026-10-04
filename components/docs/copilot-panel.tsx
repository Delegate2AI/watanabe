"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { Composer } from "@/components/kit/composer";
import { AssistantTurnBody } from "@/components/chat/assistant-turn-body";
import { useChat } from "@/components/chat/use-chat";
import { announceThreadsChanged } from "@/lib/chat/threads-changed";
import { suggestionCount, suggestionsInTurn } from "@/lib/shared-docs/copilot-derive";
import type { MessageContext } from "@/lib/agent/context";

/**
 * The doc copilot side chat (spec 2026-08-27): a real spec-24 thread bound to
 * this document via the route's `docId`. Rendered inside the tabbed rail by
 * `AnnotatedDoc`, only for comment tier and up with the flag on. The chat
 * machinery is `useChat` unchanged; what is doc-specific here is the binding
 * pass-through, the suggest-event cards, and the margin-refresh nudge.
 */
const STARTERS = [
  "Summarize this document",
  "Proofread it and propose fixes",
  "Address the open comments",
  "Check this against the knowledge base",
];

export function CopilotPanel(props: {
  docId: string;
  docTitle: string;
  /** The user's newest copilot thread on this doc, resolved server-side; null for none yet. */
  initialThreadId: string | null;
  /** A selection quote handed over from the Ask-copilot bubble action, or null. */
  pendingQuote: string | null;
  onQuoteConsumed: () => void;
  /** Nudge `useDocAnnotations().refresh` so a filed suggestion appears in the margin immediately. */
  onSuggestFiled: () => void;
}) {
  const [threadId, setThreadId] = useState(props.initialThreadId);
  const [epoch, setEpoch] = useState(0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Sparkles className="size-3.5 text-ink-faint" aria-hidden />
          Copilot
        </span>
        <button
          type="button"
          onClick={() => {
            setThreadId(null);
            setEpoch((n) => n + 1);
          }}
          className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
        >
          <RotateCcw className="size-3" aria-hidden />
          New chat
        </button>
      </div>
      {/* Keyed remount: useChat wires its resume refs at mount, so a thread
          switch (New chat) needs a fresh hook lifecycle, not a prop change. */}
      <CopilotChat key={`${threadId ?? "fresh"}:${epoch}`} threadId={threadId} {...props} />
    </div>
  );
}

function CopilotChat({
  docId,
  docTitle,
  threadId,
  pendingQuote,
  onQuoteConsumed,
  onSuggestFiled,
}: {
  docId: string;
  docTitle: string;
  threadId: string | null;
  pendingQuote: string | null;
  onQuoteConsumed: () => void;
  onSuggestFiled: () => void;
}) {
  const { turns, send, interrupt, status, hydrating } = useChat(threadId ?? undefined, {
    isNew: !threadId,
    docId,
    // Recents lists threads from the server; a brand-new copilot thread should
    // appear there without a reload, like a thread started on Home.
    onSession: () => announceThreadsChanged(),
  });

  // Margin-refresh nudge: whenever the transcript's filed-suggestion count
  // grows, the margin is stale. An extra nudge after hydration is harmless
  // (refresh is idempotent and already runs on a 10s poll).
  const seenSuggestions = useRef(0);
  useEffect(() => {
    const count = suggestionCount(turns);
    if (count > seenSuggestions.current) onSuggestFiled();
    seenSuggestions.current = count;
  }, [turns, onSuggestFiled]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function submit(value: string): void {
    const context: MessageContext[] | undefined = pendingQuote
      ? [{ type: "shared-doc-selection", docId, quote: pendingQuote, docTitle }]
      : undefined;
    void send(value, context ?? []);
    if (pendingQuote) onQuoteConsumed();
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={scrollRef} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
        {turns.length === 0 && !hydrating ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-ink-faint">Ask about this document, or start with:</p>
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => submit(starter)}
                className="rounded-chip border border-line bg-surface px-2.5 py-1.5 text-left text-xs text-ink hover:bg-surface-2"
              >
                {starter}
              </button>
            ))}
          </div>
        ) : (
          turns.map((turn) =>
            turn.role === "user" ? (
              <p key={turn.id} className="self-end whitespace-pre-wrap rounded-chip bg-surface-2 px-3 py-2 text-xs text-ink">
                {turn.content}
              </p>
            ) : turn.role === "assistant" ? (
              <div key={turn.id} className="text-sm">
                <AssistantTurnBody turn={turn} />
                {suggestionsInTurn(turn).map((ref) => (
                  <p
                    key={ref.suggestionId}
                    className="mt-1 rounded-control bg-good-soft px-2.5 py-1.5 text-xs text-ink"
                  >
                    Proposed an edit. Review it in the margin.
                  </p>
                ))}
              </div>
            ) : null,
          )
        )}
      </div>

      {pendingQuote && (
        <span className="inline-flex items-start gap-1.5 rounded-chip bg-surface-2 px-2.5 py-1.5 text-xs text-ink-muted">
          <span className="line-clamp-2 min-w-0 flex-1 italic">&quot;{pendingQuote}&quot;</span>
          <button type="button" onClick={onQuoteConsumed} aria-label="Remove selection" className="text-ink-faint hover:text-ink">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}

      <Composer
        onSubmit={submit}
        busy={status === "streaming"}
        onStop={() => void interrupt()}
        showMic={false}
        placeholder="Ask about this document"
      />
    </div>
  );
}
