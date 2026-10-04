"use client";

import type { CommentThread, Suggestion } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";
import { personFor } from "@/components/person-chip";
import { CommentThreadCard } from "./comment-thread";
import { SuggestionCard } from "./suggestion-card";

/**
 * The right-rail margin (spec 2026-07-22, surface-polish P-09): live work
 * first, settled work collapsed underneath.
 *
 * Suggestions moved in here from a `children` slot so that "settled" means one
 * thing on this rail. An accepted or rejected suggestion is as done as a
 * resolved comment, and before this it kept a full-size card at the top of the
 * gutter while resolved comments correctly collapsed. Both now land in the same
 * "Resolved (n)" disclosure. A stale suggestion stays OPEN on purpose: it still
 * needs a person to apply it by hand.
 */
export function DocMargin({
  threads,
  suggestions = [],
  canComment,
  canEdit = false,
  people = {},
  onReply,
  onResolve,
  onAccept,
  onReject,
}: {
  threads: CommentThread[];
  suggestions?: Suggestion[];
  canComment: boolean;
  canEdit?: boolean;
  people?: Record<string, Person>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string, status: "open" | "resolved") => Promise<void>;
  onAccept?: (id: string) => Promise<void>;
  onReject?: (id: string) => Promise<void>;
}) {
  const openThreads = threads.filter((t) => t.status === "open");
  const resolvedThreads = threads.filter((t) => t.status === "resolved");
  const openSuggestions = suggestions.filter((s) => s.status === "pending" || s.status === "stale");
  const resolvedSuggestions = suggestions.filter((s) => s.status === "accepted" || s.status === "rejected");
  const pending = suggestions.filter((s) => s.status === "pending");
  const noop = async () => {};

  // Sequential on purpose: each accept re-locates against the body the
  // previous one just changed. A failure (stale, conflict) marks its own card
  // via the caller's error handling and must not stop the rest.
  async function acceptAllPending(): Promise<void> {
    for (const s of pending) {
      try {
        await (onAccept ?? noop)(s.id);
      } catch {
        /* the per-item handler already surfaced it */
      }
    }
  }

  const renderSuggestion = (s: Suggestion) => (
    <SuggestionCard
      key={s.id}
      suggestion={s}
      canEdit={canEdit}
      author={personFor(people, s.createdBy.trim().toLowerCase())}
      onAccept={onAccept ?? noop}
      onReject={onReject ?? noop}
    />
  );

  const resolvedCount = resolvedThreads.length + resolvedSuggestions.length;
  const isEmpty =
    openThreads.length === 0 && openSuggestions.length === 0 && resolvedCount === 0;

  return (
    <aside className="flex w-full flex-col gap-3">
      {isEmpty ? (
        <p className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
          No comments yet. Select text on the page to comment or suggest an edit.
        </p>
      ) : null}
      {canEdit && pending.length > 1 && (
        <button
          type="button"
          onClick={() => void acceptAllPending()}
          className="self-start rounded-control border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
        >
          Accept all pending ({pending.length})
        </button>
      )}
      {openSuggestions.map(renderSuggestion)}
      {openThreads.map((t) => (
        <CommentThreadCard
          key={t.id}
          thread={t}
          canComment={canComment}
          people={people}
          onReply={onReply}
          onResolve={onResolve}
        />
      ))}
      {resolvedCount > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink">Resolved ({resolvedCount})</summary>
          <div className="mt-2 flex flex-col gap-3">
            {resolvedSuggestions.map(renderSuggestion)}
            {resolvedThreads.map((t) => (
              <CommentThreadCard
                key={t.id}
                thread={t}
                canComment={canComment}
                people={people}
                onReply={onReply}
                onResolve={onResolve}
              />
            ))}
          </div>
        </details>
      )}
    </aside>
  );
}
