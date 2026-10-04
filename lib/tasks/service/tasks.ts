import { isKnownMember } from "@/lib/authority/groups";
import { normalizeAssignees } from "@/lib/db/task-assignees";
import { createManualTask, getForRequester, getVisibleTask, type TaskRecord } from "@/lib/db/tasks";
import { log } from "@/lib/log";
import type { ServiceContext } from "@/lib/service/actor";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { isTasksEnabled } from "@/lib/tasks/config";
import { CreateTaskInput, ListTasksInput } from "./schemas";

/**
 * The list, read and create paths, owned here rather than in the route.
 *
 * Each function takes `raw: unknown` and parses it itself, which is what lets
 * the flag-then-parse-then-authorize ordering live in one place. Several of
 * those orderings are load-bearing and pinned by existing tests: a malformed
 * body with the subsystem off answers not-found, not bad-request, because the
 * flag check runs first.
 */

export function listTasks(ctx: ServiceContext, raw?: unknown): ServiceResult<{ tasks: TaskRecord[] }> {
  // This handler alone answers a success with an empty surface rather than
  // not-found when the subsystem is off. The tasks page renders that empty list;
  // changing it to a failure would turn the page into an error state.
  if (!isTasksEnabled()) return ok({ tasks: [] });

  const parsed = ListTasksInput.safeParse(raw ?? {});
  if (!parsed.success) {
    log.info("task list rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "body" });
  }

  const tasks = getForRequester(ctx.db, ctx.actor.email, ctx.actor.clearance, parsed.data.status);
  return ok({ tasks: parsed.data.limit === undefined ? tasks : tasks.slice(0, parsed.data.limit) });
}

export function getTask(ctx: ServiceContext, id: string): ServiceResult<{ task: TaskRecord }> {
  if (!isTasksEnabled()) return err("not_found");

  // Clearance, not assignment: a cleared colleague may open a task that is not
  // theirs, exactly as the detail page allows. An id that does not exist and an
  // id this caller may not see are the same answer, so neither can be used to
  // discover the other.
  const task = getVisibleTask(ctx.db, id, ctx.actor.email, ctx.actor.clearance);
  return task ? ok({ task }) : err("not_found");
}

export function createTask(
  ctx: ServiceContext,
  raw: unknown,
  now: string = new Date().toISOString(),
): ServiceResult<{ task: TaskRecord }> {
  // Before the parse, deliberately: with the subsystem off, a malformed body and
  // a well-formed one answer identically.
  if (!isTasksEnabled()) return err("not_found");

  const parsed = CreateTaskInput.safeParse(raw);
  if (!parsed.success) {
    // The zod issue names the offending field and is logged, never returned: the
    // body carries a code and a field name, not a sentence the caller wrote.
    log.info("task create rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "body" });
  }
  const body = parsed.data;

  if (!ctx.actor.clearance.includes(body.clearance)) {
    return err("invalid_request", { detail: "clearance" });
  }

  const assignees = normalizeAssignees([...(body.assignees ?? []), body.assigneeEmail]);
  // Membership only. Creation deliberately does not check that an assignee is
  // cleared for the group it stamps, unlike the assign transition, and this
  // refactor is not the place to close that gap.
  if (assignees.some((assignee) => !isKnownMember(assignee, ctx.actor.groups))) {
    return err("invalid_request", { detail: "assigneeEmail" });
  }

  const task = createManualTask(ctx.db, {
    title: body.title,
    description: body.description,
    assignees,
    clearance: [body.clearance],
    due: body.due ?? null,
    createdBy: ctx.actor.email,
    createdAt: now,
  });
  return ok({ task });
}
