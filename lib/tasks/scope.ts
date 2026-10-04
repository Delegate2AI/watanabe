import type { TaskRecord } from "@/lib/db/tasks";

/**
 * The one scope axis both task layouts read. The list and the board used to
 * each own a filter with its own words and its own state, so switching layout
 * silently reset what you were looking at.
 */
export type Scope = "mine" | "unassigned" | "team" | `group:${string}`;

/** Triage: proposed items, which the Inbox strip owns rather than either layout. */
export function isProposed(task: TaskRecord): boolean {
  return task.status === "proposed";
}

/**
 * Proposals awaiting THIS viewer's decision. Extraction resolves an assignee
 * whenever the meeting names a known member (`resolveAssignee`), so most
 * proposals are already routed and belong in that person's queue, not everyone's.
 * The same rule the sidebar badge reads through `getForRequester(..., ["proposed"])`.
 *
 * An UNASSIGNED proposal additionally requires that the viewer was in the room.
 * Without that, every unassigned proposal in a clearance landed in every
 * cleared person's Inbox, and since `deriveMeetingVisibility` fails closed to
 * `admins`, an admin's Inbox filled with decisions from meetings they had never
 * attended and could not judge.
 *
 * A task whose meeting recorded no attendees at all is the one exception: it
 * falls back to clearance so it still reaches someone. Attendance is a grant
 * here, exactly as it is in `clearanceWhere()`, never a gate that can strand
 * work with nobody able to accept it.
 *
 * `actorEmail` and `sourceAttendees` are both canonical (see `requesterKey`),
 * so this compares them directly, the same way `attendeeWhere()` does in SQL.
 */
export function needsMyTriage(task: TaskRecord, actorEmail: string): boolean {
  if (!isProposed(task)) return false;
  if (task.assignees.length > 0) return task.assignees.includes(actorEmail);
  return task.sourceAttendees.length === 0 || task.sourceAttendees.includes(actorEmail);
}

/** What the scope counts describe: accepted work that is not finished. */
export function isLive(task: TaskRecord): boolean {
  return task.status === "open" || task.status === "in_progress";
}

export function inScope(task: TaskRecord, scope: Scope, actorEmail: string): boolean {
  if (scope === "team") return true;
  // Mine asks whether the viewer is ONE of the assignees, not the first: a task
  // handed to two people belongs on both their lists.
  if (scope === "mine") return task.assignees.includes(actorEmail);
  if (scope === "unassigned") return task.assignees.length === 0;
  return task.clearance.includes(scope.slice("group:".length));
}

/** A group filter is a narrowing of Team, so the Team segment stays selected. */
export function isTeamScope(scope: Scope): boolean {
  return scope === "team" || scope.startsWith("group:");
}

/** "all-hands" reads as "All Hands", the same casing the card chips use. */
export function groupLabel(group: string): string {
  return group.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
