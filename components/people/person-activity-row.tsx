import Link from "next/link";
import { PersonChip } from "@/components/person-chip";
import { formatDateTime, formatRelative } from "@/lib/ui/date";
import { cn } from "@/lib/utils";
import type { PersonActivity } from "@/lib/people/activity";
import { personSlug } from "@/lib/people/slug";

/**
 * One person's row on `/people`: who they are, then Open, Completed, Overdue, Inbox,
 * Meetings, and when they were last seen doing anything. Every task count is
 * current; only Meetings follows the selected range.
 *
 * Presentational and server-rendered (no "use client"). It takes an
 * ALREADY-RESOLVED `PersonActivity`, so `<PersonChip>` gets a real `Person`
 * and never has to resolve an email for itself.
 *
 * The whole row is the link to the detail page, so the click target is the row
 * rather than a name-sized strip of it.
 */

/**
 * A zero reads faint, a real count reads as normal ink. The page is scanned,
 * not read: the eye should land on the people who actually have work.
 */
function toneFor(value: number): string {
  return value === 0 ? "text-ink-faint" : "font-medium text-ink";
}

function Stat({
  stat,
  label,
  value,
  tone,
}: {
  /** Stable hook for tests and for the detail page to line columns up. */
  stat: string;
  label: string;
  value: number;
  /** Overrides the default zero/non-zero tone. Only Overdue needs it. */
  tone?: string;
}) {
  return (
    <span className="flex w-[4.5rem] shrink-0 flex-col items-center gap-0.5">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span data-stat={stat} className={cn("text-[13px] tabular-nums", tone ?? toneFor(value))}>
        {value}
      </span>
    </span>
  );
}

export function PersonActivityRow({ activity }: { activity: PersonActivity }) {
  const { person, tasks, meetings, lastActivityAt } = activity;

  // An opaque key, not the address: this URL lands in browser history, in the
  // referrer of anything the detail page links out to, in access logs, and in
  // any link somebody pastes into a chat.
  return (
    <Link
      href={`/people/${personSlug(person.email)}`}
      className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface px-5 py-3 transition-colors hover:border-accent"
    >
      <span className="min-w-0 flex-1 text-[13.5px] text-ink">
        <PersonChip person={person} variant="avatar" />
      </span>

      <span className="flex items-center gap-1">
        <Stat stat="open" label="Open" value={tasks.open} />
        <Stat stat="completed" label="Completed" value={tasks.completed} />
        {/* `warn` is this codebase's danger tone (see components/tasks/due-label.tsx);
            app/design-tokens.css defines no `danger` token. It is applied ONLY when
            the count is non-zero: a wall of red zeroes would make an idle,
            perfectly healthy page look like an incident. A zero overdue is just
            another zero. */}
        <Stat
          stat="overdue"
          label="Overdue"
          value={tasks.overdue}
          tone={tasks.overdue > 0 ? "font-medium text-warn" : undefined}
        />
        <Stat stat="proposed" label="Inbox" value={tasks.proposed} />
        <Stat stat="meetings" label="Meetings" value={meetings.inWindow} />
      </span>

      <span className="flex w-28 shrink-0 flex-col items-end gap-0.5">
        <span className="text-[11px] text-ink-faint">Last activity</span>
        {lastActivityAt ? (
          // The exact day stays one hover away, so the relative label costs no
          // precision. Same contract as `<DueLabel>`.
          <time
            data-stat="last-activity"
            dateTime={lastActivityAt}
            title={formatDateTime(lastActivityAt)}
            className="text-xs text-ink-muted"
          >
            {formatRelative(lastActivityAt)}
          </time>
        ) : (
          // Words, not a bare dash: a dash next to a column of numbers reads as
          // a minus sign, and "no activity" is a finding worth spelling out.
          <span data-stat="last-activity" className="text-xs text-ink-faint">
            No activity
          </span>
        )}
      </span>
    </Link>
  );
}
