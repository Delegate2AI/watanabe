import { headers } from "next/headers";
import { Calendar } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { MeetingList } from "@/components/meetings/meeting-list";
import type { MeetingReclearAccess } from "@/components/meetings/meeting-row";
import { listMeetingNotes, type MeetingListItem } from "@/lib/meetings/list";
import { resolveIdentity } from "@/lib/identity/resolve";
import { isMeetingsEnabled } from "@/lib/meetings/config";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { can } from "@/lib/authority/roles";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { resolvePeople } from "@/lib/people/resolve";
import { attendedBy } from "@/lib/meetings/attendance";
import { aliasIndex } from "@/lib/authority/aliases";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = {
  icon: Calendar,
  eyebrow: "Meetings",
  title: "Transcribed and in the knowledge base",
  description:
    "Every meeting is transcribed, summarized, and filed at the clearance of who attended. You only see the ones you are cleared for.",
};

/**
 * The Meetings surface (spec 27), filling the spec-20 scaffold. Flag-off
 * (`MEETINGS_ENABLED` unset) it renders the identical scaffold as before, so the
 * byte-path is unchanged. On: the caller's clearance-scoped meeting notes,
 * read straight from their vault view, as a list of rows.
 */
export default async function MeetingsPage() {
  if (!isMeetingsEnabled()) {
    return <RouteScaffold {...HEADER} spec="spec 20" flag="MEETINGS_ENABLED" />;
  }

  const identity = await resolveIdentity(await headers());
  const meetings = identity ? listMeetingNotes(identity.clearance) : [];

  // Re-clearance (spec 30): admins get an inline "Edit visibility" control on
  // every meeting row, to correct a fail-closed mis-derived clearance (spec 20)
  // without touching git. Computed only for admins - the group membership read
  // is wasted work for everyone else.
  const isAdmin = identity !== null && isAuthorityEnabled() && can(identity.email, "manageAccess");
  const groups = isAdmin ? loadGroups() : {};
  const availableGroups = isAdmin ? Object.keys(groups).sort() : [];
  const reclearFor = (meeting: MeetingListItem): MeetingReclearAccess | undefined =>
    isAdmin
      ? {
          availableGroups,
          unresolvedAttendees: meeting.attendees.filter((email) => !isKnownMember(email, groups)),
        }
      : undefined;

  const aliases = aliasIndex();
  const attended = (meeting: MeetingListItem): boolean =>
    identity !== null && attendedBy(meeting.attendees, identity.email, aliases);

  // <PersonChip> takes an already-resolved person: the resolver reads the
  // directory from disk, so it runs here and not in the client list. One batch
  // covers every attendee across every visible meeting.
  const people = resolvePeople(
    meetings.flatMap((meeting) => meeting.attendees),
    identity ? { viewerEmail: identity.email } : {},
  );

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={HEADER.icon}
        eyebrow={HEADER.eyebrow}
        title={HEADER.title}
        description={HEADER.description}
      />
      {meetings.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No meetings yet. Once a meeting you attended is transcribed and filed, it shows up here.
        </p>
      ) : (
        <MeetingList
          people={people}
          entries={meetings.map((meeting) => {
            const reclear = reclearFor(meeting);
            return { meeting, attended: attended(meeting), ...(reclear ? { reclear } : {}) };
          })}
        />
      )}
    </div>
  );
}
