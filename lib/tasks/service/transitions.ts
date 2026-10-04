import { isKnownMember, resolveClearance } from "@/lib/authority/groups";
import { normalizeAssignees } from "@/lib/db/task-assignees";
import {
  acceptTask,
  assignTask,
  canTransition,
  getVisibleTask,
  reassignTask,
  setVisibleStatus,
  type TaskRecord,
  type TransitionDenial,
} from "@/lib/db/tasks";
import { isRecordedAttendee } from "@/lib/db/tasks-visibility";
import { log } from "@/lib/log";
import { isRolesEnabled } from "@/lib/authority/roles";
import type { ServiceContext } from "@/lib/service/actor";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { isTasksEnabled } from "@/lib/tasks/config";
import { TransitionInput } from "./schemas";

/**
 * Every state change a task can undergo, behind one function.
 *
 * The order below is the order the handler had and it must not be rearranged.
 * Two parts of it are load-bearing. The lifecycle guard runs BEFORE assignee
 * validation, so a wrong-status answer wins over a bad assignee list. And
 * `canTransition` deliberately duplicates the SQL preconditions of the write it
 * gates, so a refused action is refused with a reason instead of changing zero
 * rows and surfacing as a not-found for a task the caller just read.
 */

/**
 * Delete is the creator's right. Meeting-derived and agent-created tasks carry
 * no creator, and rows written before the created_by column existed carry none
 * either, so both fall back to admin-only. Never fall back to the assignee: a
 * task handed to someone is not theirs to erase.
 */
function isTaskCreator(task: TaskRecord, email: string): boolean {
  return task.createdBy !== null && task.createdBy === email;
}

/** The posted assignees, whichever field carried them, normalized and deduped. */
function postedAssignees(body: TransitionInput): string[] {
  if (body.action === "accept") return normalizeAssignees([...(body.assignees ?? []), body.assignee]);
  if (body.action === "assign" || body.action === "reassign") {
    return normalizeAssignees([...(body.assignees ?? []), body.assigneeEmail]);
  }
  return [];
}

/**
 * `TransitionDenial` is a subset of `ErrorCode`, so every reason maps straight
 * through. The one that does not is `not_cleared`: telling a caller they are not
 * cleared for a task confirms the task exists, so it collapses into the same
 * not-found an unknown id gets.
 */
function denied(reason: TransitionDenial): ServiceResult<never> {
  return reason === "not_cleared" ? err("not_found") : err(reason);
}

export function transitionTask(
  ctx: ServiceContext,
  id: string,
  raw: unknown,
): ServiceResult<{ changed: true }> {
  if (!isTasksEnabled()) return err("not_found");

  const parsed = TransitionInput.safeParse(raw);
  if (!parsed.success) {
    log.info("task patch rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "body" });
  }
  const body = parsed.data;

  const task = getVisibleTask(ctx.db, id, ctx.actor.email, ctx.actor.clearance);
  if (!task) return err("not_found");

  const transition = canTransition(
    task,
    body.action,
    {
      email: ctx.actor.email,
      clearance: ctx.actor.clearance,
      // The first half is redundant with `can`, which already answers true for
      // write when roles are off. It is kept verbatim because the two are mocked
      // independently by the route's tests, and collapsing them would be a
      // behavior change dressed as a cleanup.
      canTriage: !isRolesEnabled() || ctx.actor.can("write"),
      isCreator: isTaskCreator(task, ctx.actor.email) || ctx.actor.can("manageAccess"),
    },
    body.action === "move" ? body.status : undefined,
  );
  if (!transition.ok) return denied(transition.reason);

  const assigned = postedAssignees(body);
  // An assigning action that names nobody is a client bug, not an unassign:
  // there is no way to clear an assignee here, and silently treating it as a
  // no-op would report success for a write that did nothing.
  if ((body.action === "assign" || body.action === "reassign") && assigned.length === 0) {
    return err("invalid_request", { detail: "assignee" });
  }
  if (assigned.some((assignee) => !isKnownMember(assignee, ctx.actor.groups))) {
    return err("invalid_request", { detail: "assignee" });
  }
  // Assigning to someone who cannot see the task hands them work that is
  // invisible to them: it never appears in their board or list, and every action
  // they could take on it is not found. Fail closed instead. Attendance counts
  // as being able to see it, exactly as it does in the SQL: the assignee this
  // guard most often refuses is the person the action item was agreed with.
  for (const assignee of assigned) {
    const assigneeClearance = new Set(resolveClearance(assignee, ctx.actor.groups));
    const canSee = task.clearance.some((group) => assigneeClearance.has(group))
      || isRecordedAttendee(task.sourceAttendees, assignee);
    if (!canSee) return err("invalid_request", { detail: "assigneeClearance" });
  }

  const { db, actor } = ctx;
  let changed = false;
  if (body.action === "accept") {
    changed = acceptTask(db, id, assigned, actor.email, actor.clearance);
  } else if (body.action === "assign") {
    changed = assignTask(db, id, assigned, actor.email, actor.clearance);
  } else if (body.action === "reassign") {
    changed = reassignTask(db, id, assigned, actor.email, actor.clearance);
  } else if (body.action === "move") {
    changed = setVisibleStatus(db, id, body.status, actor.email, actor.clearance);
  } else {
    // complete finishes the work; dismiss and delete both retire the row. There
    // is no hard delete through this path.
    const status = body.action === "complete" ? "done" : "dismissed";
    changed = setVisibleStatus(db, id, status, actor.email, actor.clearance);
  }
  return changed ? ok({ changed: true }) : err("not_found");
}
