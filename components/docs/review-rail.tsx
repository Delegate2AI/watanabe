"use client";

import type { CommentThread, Suggestion, TextAnchor } from "@/lib/shared-docs/types";
import type { Person } from "@/lib/people/types";
import { AnnotationComposer } from "./annotation-composer";
import { DocMargin } from "./doc-margin";

type Composer = { kind: "comment"; anchor: TextAnchor | null } | { kind: "suggest"; anchor: TextAnchor };

/**
 * The review side of the doc rail (spec 2026-07-22's aside, extracted when the
 * rail became tabbed for the copilot, spec 2026-08-27): the error line, the
 * preview note, the gutter composer, and the margin of threads + suggestion
 * cards. State and handlers stay in `AnnotatedDoc`; this is layout only.
 */
export function ReviewRail({
  error,
  preview,
  composer,
  draft,
  onDraft,
  proposed,
  onProposed,
  note,
  onNote,
  onSubmitComment,
  onSubmitSuggest,
  onCancelComposer,
  threads,
  suggestions,
  canComment,
  canEdit,
  people,
  onReply,
  onResolve,
  onAccept,
  onReject,
}: {
  error: string | null;
  preview: boolean;
  composer: Composer | null;
  draft: string;
  onDraft: (v: string) => void;
  proposed: string;
  onProposed: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  onSubmitComment: () => void;
  onSubmitSuggest: () => void;
  onCancelComposer: () => void;
  threads: CommentThread[];
  suggestions: Suggestion[];
  canComment: boolean;
  canEdit: boolean;
  people: Record<string, Person>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string, status: "open" | "resolved") => Promise<void>;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  return (
    <>
      {/* Every annotation action can be refused (no edit access, a suggestion
          the document has moved past). Without this the refusal was silent
          and read as a dead button. */}
      {error && (
        <p role="alert" className="rounded-control bg-warn-soft px-3 py-2 text-xs text-ink">
          {error}
        </p>
      )}
      {preview && (
        <p className="text-xs text-ink-muted">
          Viewing with suggestions applied. Switch to Suggesting to comment.
        </p>
      )}
      {composer && (
        <AnnotationComposer
          composer={composer}
          draft={draft}
          onDraft={onDraft}
          proposed={proposed}
          onProposed={onProposed}
          note={note}
          onNote={onNote}
          onSubmitComment={onSubmitComment}
          onSubmitSuggest={onSubmitSuggest}
          onCancel={onCancelComposer}
        />
      )}
      {/* Suggestions are handed to the margin whole, rejected ones included:
          it is the margin that decides what is still live and what collapses
          into "Resolved". */}
      <DocMargin
        threads={threads}
        suggestions={suggestions}
        canComment={canComment}
        canEdit={canEdit}
        people={people}
        onReply={onReply}
        onResolve={onResolve}
        onAccept={onAccept}
        onReject={onReject}
      />
    </>
  );
}
