import { aliasIndex, canonicalEmail, type AliasIndex } from "@/lib/authority/aliases";

/**
 * Who may see a task, as SQL fragments plus the one helper that decides which
 * address a requester is matched by.
 *
 * Split out of `tasks.ts` because these three predicates are the security-
 * relevant half of that module: every read path composes one of them, and a
 * mistake here is silent (rows quietly missing, or quietly visible) rather than
 * a crash.
 */

/**
 * The address a task's `assignee_email` is compared against.
 *
 * Every write path stores a CANONICAL address. `lib/tasks/resolve.ts` maps a
 * meeting attendee's personal address to the canonical portal identity before
 * assigning ("Resolve to the canonical portal identity first and assign that,
 * never the alias").
 *
 * The manual, accept and reassign paths do NOT: they validate with
 * `isKnownMember`, which canonicalizes both sides and therefore accepts an
 * alias, then store the address as submitted. So a row can hold either form,
 * and anything comparing against `assignee_email` has to canonicalize both
 * sides rather than assume the stored value is canonical (`isAssignee` in
 * `lib/tasks/lifecycle.ts` does; this SQL and the client-side filters still do
 * not, so a task assigned under an alias falls out of the Mine scope and shows
 * no completion checkbox even though the write behind it is permitted).
 *
 * Canonicalizing in `fromRow` looks like the fix and is not: `assignableMembers`
 * keeps the raw alias for a person whose canonical address is not itself on the
 * roster, so a canonical `assigneeEmail` would match no `<option>` and the
 * assignee selects would read "Unassigned". Closing this properly means folding
 * the picker and the stored value together.
 *
 * The read side had no matching step. A session authenticated under any other
 * address the same person owns therefore matched none of its own tasks, and the
 * failure was invisible in the worst way: such a task still satisfies the
 * clearance half of `visibleWhere` and fails only the assignee half, so it
 * appears under "All", renders an assignee chip naming the viewer (the people
 * layer resolves aliases), and never appears under "Mine".
 *
 * An address that is not an alias passes through normalized and unchanged, so
 * this is a no-op wherever the registry is empty or the session already
 * authenticates canonically.
 */
export function requesterKey(email: string, aliases: AliasIndex = aliasIndex()): string {
  return canonicalEmail(email, aliases);
}

/**
 * Group intersection: the requester shares at least one group with the task.
 *
 * Exported on its own for the KB graph overlay (spec
 * 2026-08-17-kb-task-links-design), which deliberately composes this half
 * WITHOUT the attendee grant: the overlay drops any task whose source note is
 * outside the requester's projection, and the attendee grant could only ever
 * admit exactly those tasks, so group-half-plus-anchoring equals full task
 * visibility for that surface while keeping its payload a pure function of the
 * clearance set. Every other read path composes `clearanceWhere()`.
 */
export function groupWhere(): string {
  return `
    EXISTS (
      SELECT 1 FROM json_each(tasks.clearance) task_group
      JOIN json_each(@requesterClearance) requester_group
        ON requester_group.value = task_group.value
    )
  `;
}

/**
 * Attendance: the requester is recorded as having attended the source meeting.
 *
 * A grant, not a filter. A task inherits its clearance from the source note's
 * visibility, and `deriveMeetingVisibility` falls back to `["admins"]` whenever
 * no attendee resolves to a group (and drops `all-hands` on one unknown
 * address). Without this the people who were in the room fail the group
 * intersection on every read path: the action items they agreed to are invisible
 * to them and pile up in the admins queue instead.
 *
 * Attendance is compared canonically. Writes store canonical addresses (see
 * `requesterKey`), and `runner.ts` canonicalizes every attendee through the same
 * alias registry before snapshotting the list.
 */
function attendeeWhere(): string {
  return `
    EXISTS (
      SELECT 1 FROM json_each(tasks.source_attendees) attendee
      WHERE attendee.value = @requesterEmail
    )
  `;
}

/**
 * Who may see this task at all: someone the clearance covers, OR someone who was
 * in the meeting it came from. Every read path composes this, so both bindings
 * (`@requesterClearance` and `@requesterEmail`) are required everywhere.
 */
export function clearanceWhere(): string {
  return `(${groupWhere()} OR ${attendeeWhere()})`;
}

/** The JS twin of {@link attendeeWhere}, for the lifecycle guard. */
export function isRecordedAttendee(
  attendees: string[],
  email: string,
  aliases: AliasIndex = aliasIndex(),
): boolean {
  const key = requesterKey(email, aliases);
  return attendees.some((attendee) => attendee.trim().toLowerCase() === key);
}

/**
 * The assignee half, over the full assignee list rather than the primary alone.
 *
 * A task assigned to two people is in BOTH their queues, so this asks whether
 * the requester is among them, not whether they are first. `assignees` is NOT
 * NULL DEFAULT '[]' (v35) and is only ever written through `assigneeWrite`, so
 * `json_each` always has well-formed JSON to walk.
 */
export function isAssigneeWhere(): string {
  return `
    EXISTS (
      SELECT 1 FROM json_each(tasks.assignees) assignee
      WHERE assignee.value = @requesterEmail
    )
  `;
}

/** Visible to them AND the task is their own (assigned to them, or unassigned). */
export function visibleWhere(): string {
  return `${clearanceWhere()} AND (${isAssigneeWhere()} OR tasks.assignee_email IS NULL)`;
}

/**
 * The board and the "All" tab deliberately drop the assignee half: the point of
 * a team board is to show the team's work, not only your own.
 */
export function boardVisibleWhere(): string {
  return clearanceWhere();
}
