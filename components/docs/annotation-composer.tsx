"use client";

import { MessageSquarePlus, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TextAnchor } from "@/lib/shared-docs/types";

type Composer =
  | { kind: "comment"; anchor: TextAnchor | null }
  | { kind: "suggest"; anchor: TextAnchor };

const fieldClass =
  "w-full rounded-control border border-line bg-surface-2 p-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-0";

/**
 * The gutter composer (redesign 2026-07-22) for a new comment or a proposed
 * edit. Compact and anchored: it echoes the quoted selection so the card reads
 * as attached to the text, instead of the old full-width margin box. Field state
 * and submit handlers stay in AnnotatedDoc; this is the presentational shell.
 */
export function AnnotationComposer({
  composer,
  draft,
  onDraft,
  proposed,
  onProposed,
  note,
  onNote,
  onSubmitComment,
  onSubmitSuggest,
  onCancel,
}: {
  composer: Composer;
  draft: string;
  onDraft: (v: string) => void;
  proposed: string;
  onProposed: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  onSubmitComment: () => void;
  onSubmitSuggest: () => void;
  onCancel: () => void;
}) {
  if (composer.kind === "comment") {
    return (
      <div className="rounded-card border border-line bg-surface p-3 shadow-card">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
          <MessageSquarePlus className="size-3.5 text-ink-muted" aria-hidden />
          {composer.anchor ? "Comment on selection" : "General comment"}
        </div>
        {composer.anchor?.quote ? (
          <p className="mb-2 line-clamp-2 rounded bg-[color-mix(in_srgb,#f5c518_18%,transparent)] px-2 py-1 text-xs text-ink-muted">
            “{composer.anchor.quote}”
          </p>
        ) : null}
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="Add a comment"
          className={`min-h-[64px] ${fieldClass}`}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSubmitComment}>
            Comment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink">
        <PencilLine className="size-3.5 text-ink-muted" aria-hidden />
        Suggest an edit
      </div>
      <p className="mb-2 rounded bg-warn-soft px-2 py-1 text-xs">
        <span className="text-ink-muted line-through decoration-warn/60">
          {composer.anchor.quote}
        </span>
      </p>
      <textarea
        autoFocus
        value={proposed}
        onChange={(e) => onProposed(e.target.value)}
        placeholder="Proposed replacement (blank to delete)"
        className={`min-h-[64px] ${fieldClass}`}
      />
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="Note (optional)"
        className={`mt-2 ${fieldClass}`}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSubmitSuggest}>
          Suggest
        </Button>
      </div>
    </div>
  );
}
