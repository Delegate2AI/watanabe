"use client";

import { ArrowDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import { AssistantMessage } from "./assistant-message";
import { ContextChip } from "./context-chip";
import { PermissionModal } from "./permission-modal";
import { EmptyState } from "./empty-state";
import { ThinkingIndicator } from "./thinking-indicator";
import { useAgentChat } from "./use-agent-chat";
import type { AgentChatIdentity } from "./chat-types";
import type { ModelOption } from "@/lib/agent/model-options";

/**
 * The knowledge-base contributor chat.
 *
 * Read-only by default (see lib/agent/permissions.ts); when `KB_WRITE_ENABLED=1`
 * the backend's PreToolUse gate confirm-gates `kb_submit` (spec 10), which is
 * what `pending`/`PermissionModal` are for. Confirm-gated Bash calls can also
 * emit a `permission_request` event. A successful staging/discard/submit
 * result also drives the draft-state live-refresh (spec 12 D26).
 *
 * This component is render-only; all behaviour lives in `useAgentChat` (which
 * composes `useChatSession`, `useChatScroll`, `useTurnStream`, and
 * `useRouterRefresh`).
 *
 * `compact`/`pageContext` support the `/embed` route (a narrow iframe panel
 * embedded on the Quartz docs site, see app/embed/page.tsx): `compact` swaps
 * the page-level height calc for one that fills its container instead of the
 * full-page layout's chrome, and lets the top bar wrap instead of clipping in
 * a ~380px panel. `pageContext` (the docs page the iframe was opened from)
 * surfaces as an extra starter card ahead of the generic ones.
 *
 * `memoryEnabled` mirrors the server-only `MEMORY_ENABLED` gate
 * (lib/memory/config.ts#isMemoryEnabled) into the client: each server page
 * that renders this component resolves it at request time and passes it
 * down as a prop, since the portal is runtime-configured and a
 * `NEXT_PUBLIC_*` build-time env var would not track it.
 */
export function AgentChat({
  identity,
  compact = false,
  pageContext,
  memoryEnabled = false,
  dictationEnabled = false,
  models = [],
  modelSwitchingEnabled = false,
}: {
  identity?: AgentChatIdentity | null;
  compact?: boolean;
  pageContext?: string;
  memoryEnabled?: boolean;
  /** Whether voice dictation is configured server-side (isDictationEnabled). */
  dictationEnabled?: boolean;
  /** Server-resolved model allowlist for the composer's selector. */
  models?: ModelOption[];
  /** Whether per-chat model switching is enabled server-side (AGENT_CHAT_MODELS). */
  modelSwitchingEnabled?: boolean;
}) {
  const {
    turns,
    busy,
    prefill,
    pending,
    statusText,
    endingSession,
    memoryNotice,
    showThinking,
    effectivePageContext,
    chatCtx,
    sessions,
    currentId,
    contextUsage,
    scroll,
    pickStarter,
    send,
    newChat,
    switchTo,
    stop,
    endSession,
    decide,
  } = useAgentChat({ pageContext });

  const { scrollRef, bottomRef, handleScroll, showJumpToBottom, scrollToBottom } = scroll;

  return (
    <div
      className={cn(
        // `agent-chat` scopes the markdown prose tokens to the green chat accent
        // (see `.agent-chat .md` in globals.css); every other `.md` surface uses
        // the terracotta shell palette by default.
        "agent-chat relative flex flex-col",
        // Non-compact (full `/chat` page) now renders under the persistent
        // top nav (components/layout/site-nav.tsx, ~2.5rem) in addition to
        // this page's own header — bumped from 10rem to keep the composer
        // from being pushed below the fold.
        compact ? "h-full" : "h-[calc(100dvh-13rem)]",
      )}
    >
      {/* Top bar: new chat, past-session picker, context meter. */}
      <div
        className={cn(
          "mb-3 flex items-center gap-2 border-b border-[var(--color-line)] pb-3",
          compact && "flex-wrap",
        )}
      >
        <button
          type="button"
          onClick={newChat}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </button>
        {sessions.length > 0 && (
          <select
            value={currentId ?? ""}
            onChange={(e) => switchTo(e.target.value)}
            disabled={busy}
            className="max-w-[18rem] truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-ink-muted)] outline-none disabled:opacity-50"
          >
            <option value="">Past chats…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        {memoryEnabled && currentId && (
          <button
            type="button"
            onClick={endSession}
            disabled={endingSession}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            End and save to memory
          </button>
        )}
        {memoryNotice && <span className="text-[10px] text-[var(--color-ink-faint)]">{memoryNotice}</span>}
        <div
          className={cn(
            "ml-auto flex items-center gap-3 text-[10px] text-[var(--color-ink-faint)]",
            compact && "w-full justify-between",
          )}
        >
          {identity ? (
            <span title={identity.email}>
              Signed in as{" "}
              <span className="font-medium text-[var(--color-ink-muted)]">
                {identity.name ?? identity.email}
              </span>
            </span>
          ) : (
            <span className="text-red-500">Not signed in</span>
          )}
          {/* Both meters tick upward mid-stream — tabular numerals keep the
              glyph widths fixed so the row doesn't jitter on every token. */}
          {contextUsage && (
            <span
              className="tabular-nums"
              title={`${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} tokens`}
            >
              context {Math.round(contextUsage.percentage)}%
            </span>
          )}
          {/* Session USD cost is operator telemetry, not for the end user
              reading a KB answer; the context meter stays, the dollar amount
              does not (F-21, consistent with the main chat). */}
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-5 overflow-y-auto pb-4">
        {turns.length === 0 && !busy ? (
          <EmptyState onPick={pickStarter} pageContext={effectivePageContext} />
        ) : (
          turns.map((turn) => {
            if (turn.role === "user") {
              return (
                <div key={turn.id} className="flex flex-col items-end gap-1">
                  {turn.context && turn.context.length > 0 && (
                    <div className="flex max-w-[80%] flex-wrap justify-end gap-1">
                      {turn.context.map((chip, i) => (
                        <ContextChip key={i} chip={chip} />
                      ))}
                    </div>
                  )}
                  <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-[var(--color-accent)] px-4 py-2.5 text-sm text-[var(--color-accent-fg)]">
                    {turn.content}
                  </div>
                </div>
              );
            }
            if (turn.role === "assistant") return <AssistantMessage key={turn.id} turn={turn} />;
            if (turn.role === "compaction") {
              return (
                <div
                  key={turn.id}
                  className="flex items-center justify-center py-2 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]"
                >
                  — conversation compacted ({turn.trigger}) —
                </div>
              );
            }
            return null;
          })
        )}
        {showThinking && <ThinkingIndicator label={statusText ?? "Thinking…"} />}
        <div ref={bottomRef} />
      </div>

      {showJumpToBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] shadow-md transition-colors hover:text-[var(--color-ink-strong)]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        </div>
      )}

      <div className="border-t border-[var(--color-line)] pt-3">
        {chatCtx && chatCtx.pendingContext.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {chatCtx.pendingContext.map((chip, i) => (
              <ContextChip
                key={i}
                // This legacy surface only ever attaches vault selections; the
                // shared-doc member (spec 2026-08-27) is narrowed for the type
                // and rendered by its id if one ever reaches here.
                chip={
                  chip.type === "doc-selection"
                    ? {
                        path: chip.path,
                        headingTrail: chip.headingTrail,
                        startLine: chip.startLine,
                        endLine: chip.endLine,
                        preview: chip.selectedText,
                      }
                    : { path: `shared-doc:${chip.docId}`, headingTrail: [], startLine: 1, endLine: 1, preview: chip.quote }
                }
                onRemove={() => chatCtx.removeChip(i)}
              />
            ))}
          </div>
        )}
        <Composer
          onSend={(text) => send(text, chatCtx?.pendingContext ?? [])}
          onStop={stop}
          busy={busy}
          prefill={prefill}
          dictationEnabled={dictationEnabled}
          modelThreadId={currentId ?? undefined}
          models={models}
          modelSwitchingEnabled={modelSwitchingEnabled}
        />
      </div>

      {statusText && !pending && !showThinking && (
        <div className="px-5 py-2 text-xs text-[var(--color-ink-faint)]">{statusText}</div>
      )}
      {pending && <PermissionModal pending={pending} onDecide={(d) => decide(pending.requestId, d)} />}
    </div>
  );
}
