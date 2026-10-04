"use client";

import { PencilLine } from "lucide-react";
import type { Suggestion } from "@/lib/shared-docs/types";
import { Button } from "@/components/ui/button";
import { PersonChip, fallbackPerson } from "@/components/person-chip";
import type { Person } from "@/lib/people/types";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

/**
 * One side of the diff. Labelled and conventionally coloured (surface-polish
 * P-09): before this, the removed and the added text ran together in one
 * paragraph, separated by nothing but a faint background shift, so a reader
 * could not tell which half was the proposal.
 */
function DiffRow({ label, text, tone }: { label: string; text: string; tone: "removed" | "added" }) {
  const isRemoved = tone === "removed";
  return (
    <div className="flex gap-2">
      <span
        aria-hidden
        className={`mt-px w-4 shrink-0 select-none text-center font-mono text-xs ${isRemoved ? "text-warn" : "text-good"}`}
      >
        {isRemoved ? "-" : "+"}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[10px] font-semibold uppercase tracking-wide ${isRemoved ? "text-warn" : "text-good"}`}>
          {label}
        </span>
        <span
          className={`block whitespace-pre-wrap break-words rounded-sm px-1 py-0.5 text-ink ${
            isRemoved ? "bg-warn-soft line-through decoration-warn/60" : "bg-good-soft"
          }`}
        >
          {text || <span className="italic text-ink-muted">(nothing)</span>}
        </span>
      </span>
    </div>
  );
}

/**
 * One proposed-edit card in the gutter (spec 2026-07-22, redesign): a readable
 * two-row diff, the author, when it was proposed, an optional note, and
 * Accept/Reject for editors while the suggestion is still pending.
 *
 * `author` is resolved server-side and passed in, because `<PersonChip>` takes
 * an already-resolved person and the resolver reaches `node:fs`. A suggestion
 * created in this session, before any server render, degrades to the address.
 */
export function SuggestionCard({
  suggestion, canEdit, onAccept, onReject, author,
}: {
  suggestion: Suggestion;
  canEdit: boolean;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  author?: Person;
}) {
  const s = suggestion;
  const person = author ?? fallbackPerson(s.createdBy);
  return (
    <div className="rounded-card border border-line bg-surface p-3 text-sm shadow-card">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-ink-muted">
        <PencilLine className="size-3.5 shrink-0" aria-hidden />
        <PersonChip person={person} />
        <span className="shrink-0">suggested an edit</span>
        {s.via === "copilot" && (
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-medium text-ink">
            via Copilot
          </span>
        )}
        <time
          dateTime={s.createdAt}
          title={formatDateTime(s.createdAt)}
          className="ml-auto shrink-0 text-ink-faint"
        >
          {formatRelative(s.createdAt)}
        </time>
      </div>
      <div className="flex flex-col gap-1.5">
        <DiffRow label="Removed" text={s.originalText} tone="removed" />
        <DiffRow label="Added" text={s.proposedText} tone="added" />
      </div>
      {s.note && <p className="mt-1.5 text-xs text-ink-muted">{s.note}</p>}
      {s.status === "stale" && (
        <p className="mt-2 text-xs text-warn">The text changed; this could not auto-apply. Apply it by hand.</p>
      )}
      {s.status === "pending" && canEdit && (
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onReject(s.id)}>
            Reject
          </Button>
          <Button size="sm" onClick={() => onAccept(s.id)}>
            Accept
          </Button>
        </div>
      )}
      {s.status !== "pending" && s.status !== "stale" && (
        <span className="mt-2 block text-xs capitalize text-ink-muted">{s.status}</span>
      )}
    </div>
  );
}
