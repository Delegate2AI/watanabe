import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { aliasIndex } from "@/lib/authority/aliases";
import { isRecordedAttendee, requesterKey } from "@/lib/db/tasks-visibility";

export type TaskAction = "accept" | "dismiss" | "complete" | "assign" | "reassign" | "move" | "delete";
export type TransitionDenial =
  | "not_cleared"
  | "not_assignee"
  | "terminal"
  | "wrong_status"
  | "needs_role";
export type TransitionResult = { ok: true } | { ok: false; reason: TransitionDenial };

export interface TransitionActor {
  email: string;
  clearance: string[];
  canTriage: boolean;
  isCreator: boolean;
}

/**
 * Both sides through one alias index. `isKnownMember` validates an assignee
 * canonically but the write paths store the address as submitted, so a row can
 * hold either form and canonicalizing only the actor would refuse the very
 * person it is meant to match.
 */
function isAssignee(task: TaskRecord, email: string): boolean {
  if (task.assignees.length === 0) return false;
  const aliases = aliasIndex();
  const actor = requesterKey(email, aliases);
  return task.assignees.some((assignee) => requesterKey(assignee, aliases) === actor);
}

export function canTransition(
  task: TaskRecord,
  action: TaskAction,
  actor: TransitionActor,
  targetStatus?: TaskStatus,
): TransitionResult {
  // Attendance is a grant alongside clearance, matching the SQL every read and
  // write path composes (`clearanceWhere`). Without the same OR here, the people
  // this grant exists for would see the task and then be refused by the guard.
  const actorGroups = new Set(actor.clearance);
  const cleared = task.clearance.some((group) => actorGroups.has(group))
    || isRecordedAttendee(task.sourceAttendees, actor.email);
  if (!cleared) {
    return { ok: false, reason: "not_cleared" };
  }

  if (task.status === "dismissed" || (task.status === "done" && action !== "move")) {
    return { ok: false, reason: "terminal" };
  }

  if (action === "accept" || action === "dismiss") {
    if (task.status !== "proposed") return { ok: false, reason: "wrong_status" };
    return actor.canTriage ? { ok: true } : { ok: false, reason: "needs_role" };
  }

  if (action === "complete") {
    // In progress completes too. `move` into done already accepts it, so an
    // open-only rule here only made the checkbox and the board disagree.
    if (task.status !== "open" && task.status !== "in_progress") {
      return { ok: false, reason: "wrong_status" };
    }
    return isAssignee(task, actor.email)
      ? { ok: true }
      : { ok: false, reason: "not_assignee" };
  }

  if (action === "assign") {
    // assignTask's SQL also requires assignee_email IS NULL. Without the same
    // check here the write silently changes no rows and the route answers 404
    // for a task the requester just read, which is the failure this spec set
    // out to remove. Reassigning an already-assigned task is what reassign is.
    return task.status === "proposed" && task.assigneeEmail === null
      ? { ok: true }
      : { ok: false, reason: "wrong_status" };
  }

  if (action === "reassign") {
    return task.status === "open" || task.status === "in_progress"
      ? { ok: true }
      : { ok: false, reason: "wrong_status" };
  }

  if (action === "move") {
    if (task.status !== "open" && task.status !== "in_progress" && task.status !== "done") {
      return { ok: false, reason: "wrong_status" };
    }
    // Moving INTO done is completing by another name. Without this, the
    // assignee guard on complete is unenforceable: any cleared member could
    // drag someone else's card to Done and mark their work finished.
    if (targetStatus === "done" && task.status !== "done") {
      return isAssignee(task, actor.email) || actor.canTriage
        ? { ok: true }
        : { ok: false, reason: "not_assignee" };
    }
    return { ok: true };
  }

  return (task.status === "open" || task.status === "in_progress") && actor.isCreator
    ? { ok: true }
    : { ok: false, reason: "needs_role" };
}
