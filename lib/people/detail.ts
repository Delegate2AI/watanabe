import type { Database as DatabaseType } from "better-sqlite3";
import { aliasIndex } from "@/lib/authority/aliases";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { can } from "@/lib/authority/roles";
import type { TaskRecord } from "@/lib/db/tasks";
import type { MeetingListItem } from "@/lib/meetings/list";
import { isTaskOverdue, todayFrom } from "./overdue";
import { buildRoster, normalizeEmail, readFeeds } from "./roster";
import { personSlug } from "./slug";
import type { Person } from "./types";

/**
 * One person's page (2026-08-05 people activity dashboard). The list view needs
 * counts, this needs the rows behind them, so the same two feeds are grouped a
 * second way rather than `PersonActivity` being widened with arrays the list
 * would never render.
 *
 * Never throws: it composes never-throws readers, and a person with nothing at
 * all is a legitimate answer (an empty page), not an error.
 */

export interface PersonDetail {
  person: Person;
  tasks: {
    overdue: TaskRecord[];
    inProgress: TaskRecord[];
    open: TaskRecord[];
    proposed: TaskRecord[];
    completed: TaskRecord[];
  };
  meetings: MeetingListItem[];
  /**
   * The person's clearance groups, and EMPTY for most viewers.
   *
   * Group membership is admin-only everywhere else in the app (it lives on
   * `/admin/access`), and naming someone's groups discloses the existence and
   * composition of `exec`, `finance` or `admins` to anyone who can open a
   * profile. So it is resolved only for a viewer who already administers access,
   * for whom it is not a disclosure at all.
   */
  groups: string[];
}

/**
 * Group badges are for administrators only. Resolved here rather than hidden in
 * the page, so the data is never assembled for a viewer who may not see it, and
 * so `loadGroups()` does not run at all while authority is dormant.
 */
function groupsFor(viewerEmail: string, targetEmail: string): string[] {
  if (!isAuthorityEnabled() || !can(viewerEmail, "manageAccess")) return [];
  return resolveClearance(targetEmail, loadGroups());
}

/**
 * The detail for one person, or null when they are not in the roster THIS
 * viewer can see. Returning null (which the route turns into a 404) is what
 * keeps the page from becoming a probe: an uncleared viewer must not be able to
 * tell an address that does not exist apart from a colleague whose work they are
 * not cleared to read.
 */
export function personDetail(
  db: DatabaseType,
  viewerEmail: string,
  viewerClearance: string[],
  /**
   * Either the opaque `personSlug` the page links by, or a raw email address.
   * The address is still accepted so links shared before the slug existed keep
   * resolving; nothing emits one any more.
   */
  targetKey: string,
): PersonDetail | null {
  // Read once and threaded through every join below: the alias index is what
  // makes a person's two addresses one person, and this page filters both feeds
  // against it row by row.
  const aliases = aliasIndex();
  const target = normalizeEmail(targetKey, aliases);
  const slug = targetKey.trim().toLowerCase();
  if (!target && !slug) return null;

  try {
    // Read the feeds once and hand them to the roster, rather than letting
    // buildRoster read them again: this page needs the rows themselves, so the
    // reads cannot be avoided, only shared.
    const feeds = readFeeds(db, viewerEmail, viewerClearance);
    // Matched against the roster either way, so the 404 semantics are the same
    // for an unknown slug as for an uncleared colleague: still not a probe.
    const person = buildRoster(db, viewerEmail, viewerClearance, feeds)
      .find(
        (candidate) =>
          normalizeEmail(candidate.email, aliases) === target || personSlug(candidate.email) === slug,
      );
    if (!person) return null;

    const target2 = normalizeEmail(person.email, aliases);
    const tasks = feeds.tasks.filter(
      (task) => normalizeEmail(task.assigneeEmail, aliases) === target2,
    );
    const meetings = feeds.meetings.filter((meeting) =>
      meeting.attendees.some((attendee) => normalizeEmail(attendee, aliases) === target2),
    );

    const today = todayFrom(new Date());
    const overdue = tasks.filter((task) => isTaskOverdue(task, today));
    const current = (task: TaskRecord) => !isTaskOverdue(task, today);

    return {
      person,
      tasks: {
        overdue,
        // Every group below excludes the overdue rows, so a task is listed once.
        // An overdue in-progress task belongs under Overdue: that is the fact
        // the viewer came for, and listing it twice would make the list view's
        // counts look wrong next to this page.
        inProgress: tasks.filter((task) => task.status === "in_progress" && current(task)),
        open: tasks.filter((task) => task.status === "open" && current(task)),
        proposed: tasks.filter((task) => task.status === "proposed" && current(task)),
        completed: tasks.filter((task) => task.status === "done"),
      },
      meetings,
      groups: groupsFor(viewerEmail, person.email),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[people] failed to build the person detail: ${message}`);
    return null;
  }
}
