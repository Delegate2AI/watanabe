import { PersonChip } from "@/components/person-chip";
import { personFor } from "@/components/person-view";
import type { Person } from "@/lib/people/types";

/** Past this many, the rest collapse into a `+N` so one long meeting cannot
 *  push the date and duration off a narrow row. */
const SHOWN = 4;

/**
 * Who was in the meeting.
 *
 * The row used to say "3 attendees", which is the one fact about a meeting that
 * is never what you want to know: clearance is DERIVED from attendance, so the
 * attendee list is what explains the visibility chip sitting next to it. The
 * count stays, in the `title`, so the collapsed form still answers "how many".
 *
 * The emails are already parsed into `MeetingListItem.attendees` by
 * `lib/meetings/list.ts` (global search matches against them), so this is a
 * rendering change and nothing else reads the note again. `people` is resolved
 * on the server page: `<PersonChip>` renders a person, it never looks one up.
 */
export function Attendees({
  attendees,
  people,
}: {
  attendees: string[];
  people: Record<string, Person>;
}) {
  const label = `${attendees.length} ${attendees.length === 1 ? "attendee" : "attendees"}`;
  if (attendees.length === 0) return <span title={label}>No attendees recorded</span>;

  const shown = attendees.slice(0, SHOWN);
  const hidden = attendees.slice(SHOWN);

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={label}>
      {shown.map((email, index) => (
        <span key={email} className="inline-flex items-center">
          <PersonChip person={personFor(people, email)} />
          {index < shown.length - 1 ? <span aria-hidden="true">,</span> : null}
        </span>
      ))}
      {hidden.length > 0 ? (
        // The overflow names the people it hides, so the count is never a dead
        // end: hovering says exactly who else was there.
        <span title={hidden.join(", ")}>+{hidden.length}</span>
      ) : null}
    </span>
  );
}
