"use client";

import { PersonChip, personFor } from "@/components/person-chip";
import type { AccessHistoryEntry } from "@/lib/authority/access";
import type { Person } from "@/lib/people/types";
import { formatDateTime, formatRelative } from "@/lib/ui/date";

/**
 * The History tab: one row per access commit.
 *
 * The row shows nothing but the commit subject, so the subject has to say what
 * moved. `lib/authority/access.ts` writes a specific one now, and the actor
 * renders through the person chip rather than as `name (email)`, which printed
 * the same address twice whenever the two agreed.
 */
export function AccessHistory({
  history,
  people,
}: {
  history: AccessHistoryEntry[];
  people: Record<string, Person>;
}) {
  const cardClass = "rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";

  if (history.length === 0) {
    return <p className={`${cardClass} text-sm text-ink-muted`}>No access commits yet.</p>;
  }

  return (
    <ol className="space-y-2">
      {history.map((entry) => (
        <li key={entry.sha} className={cardClass}>
          <p className="font-medium text-ink">{entry.summary}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
            <PersonChip person={personFor(people, entry.email)} />
            <span aria-hidden>·</span>
            <time dateTime={entry.at} title={formatDateTime(entry.at)}>{formatRelative(entry.at)}</time>
          </p>
        </li>
      ))}
    </ol>
  );
}
