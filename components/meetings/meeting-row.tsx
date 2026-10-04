import Link from "next/link";
import { Calendar, Clock, Users } from "lucide-react";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { ReclearControl } from "@/components/meetings/reclear-control";
import type { MeetingListItem } from "@/lib/meetings/list";
import { formatDate, formatDateTime } from "@/lib/ui/date";
import { Attendees } from "@/components/meetings/attendees";
import type { Person } from "@/lib/people/types";

export interface MeetingReclearAccess {
  availableGroups: string[];
  /** Attendees on this meeting not resolvable to any group in access/groups.yaml. */
  unresolvedAttendees: string[];
}

export function MeetingRow({
  meeting,
  people,
  reclear,
}: {
  meeting: MeetingListItem;
  /** Resolved on the server. `<PersonChip>` never resolves for itself. */
  people: Record<string, Person>;
  /** Present only when the viewer is an admin and AUTHORITY_ENABLED is on. */
  reclear?: MeetingReclearAccess;
}) {
  return (
    <article className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4">
      <Calendar className="size-5 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <Link className="font-semibold text-ink hover:underline" href={meeting.href}>
          {meeting.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <time dateTime={meeting.date} title={formatDateTime(meeting.date)}>
            {formatDate(meeting.date)}
          </time>
          <span className="inline-flex min-w-0 items-center gap-1">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <Attendees attendees={meeting.attendees} people={people} />
          </span>
          {meeting.durationMinutes !== undefined ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden />
              {meeting.durationMinutes} min
            </span>
          ) : null}
        </div>
      </div>
      <VisibilityChip visibility={meeting.visibility} group={meeting.group} />
      {reclear && (
        <ReclearControl
          notePath={meeting.notePath}
          visibilityGroups={meeting.visibilityGroups}
          unresolvedAttendees={reclear.unresolvedAttendees}
          availableGroups={reclear.availableGroups}
        />
      )}
    </article>
  );
}
