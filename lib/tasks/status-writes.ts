import type { Database as DatabaseType } from "better-sqlite3";
import type { TaskStatus } from "@/lib/db/tasks";
import { assigneeWrite } from "@/lib/db/task-assignees";
import { clearanceWhere, requesterKey } from "@/lib/db/tasks-visibility";

/**
 * The same predicate the read paths compose, so a task someone can SEE is a task
 * they can act on. Held apart from the read module only by import direction: it
 * used to be a local copy, which drifted the moment attendance became a grant.
 */
const VISIBLE_WHERE = clearanceWhere();

/**
 * Statuses a row may be in for a given target to be a legal write. This is the
 * store's own floor, not a substitute for canTransition: the caller still owns
 * the authorization rules. It exists so a future caller cannot resurrect a
 * dismissed task or stamp done onto a proposed one just by naming a status.
 */
const LEGAL_FROM: Record<TaskStatus, readonly TaskStatus[]> = {
  proposed: [],
  open: ["proposed", "open", "in_progress", "done"],
  in_progress: ["open", "in_progress", "done"],
  done: ["open", "in_progress", "done"],
  dismissed: ["proposed", "open", "in_progress"],
};

/**
 * The path the UI takes: the detail page and the board both come through here,
 * so `completed_at` is written here as well as in `setStatus`. A stamp in only
 * one of the two would disagree with `status` as soon as anyone used the app
 * rather than calling the other function directly.
 */
export function setVisibleStatus(
  db: DatabaseType,
  id: string,
  status: TaskStatus,
  requesterEmail: string,
  requesterClearance: string[],
  now: string = new Date().toISOString(),
): boolean {
  const from = LEGAL_FROM[status];
  if (from.length === 0) return false;
  const result = db.prepare(`
    UPDATE tasks SET status = @status, completed_at = @completedAt
    WHERE id = @id AND status IN (${from.map((_, i) => `@from${i}`).join(", ")}) AND ${VISIBLE_WHERE}
  `).run({
    id,
    status,
    completedAt: status === "done" ? now : null,
    ...Object.fromEntries(from.map((value, i) => [`from${i}`, value])),
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  });
  return result.changes > 0;
}

/**
 * Accepting with an empty list keeps whoever was already assigned, which is why
 * both columns are COALESCEd rather than overwritten: the Accept button posts no
 * assignee when the triager did not touch the picker.
 */
export function acceptTask(
  db: DatabaseType,
  id: string,
  assigneeEmails: string[],
  requesterEmail: string,
  requesterClearance: string[],
): boolean {
  const written = assigneeEmails.length > 0 ? assigneeWrite(assigneeEmails) : null;
  const result = db.prepare(`
    UPDATE tasks SET
      status = 'open',
      assignee_email = COALESCE(@assigneeEmail, assignee_email),
      assignees = COALESCE(@assignees, assignees)
    WHERE id = @id AND status = 'proposed' AND ${VISIBLE_WHERE}
  `).run({
    id,
    assigneeEmail: written?.assigneeEmail ?? null,
    assignees: written?.assignees ?? null,
    requesterEmail: requesterKey(requesterEmail),
    requesterClearance: JSON.stringify(requesterClearance),
  });
  return result.changes > 0;
}
