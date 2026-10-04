import { randomUUID } from "node:crypto";
import {
  addComment,
  deleteComment,
  editComment,
  getComment,
  listComments,
  type TaskComment,
} from "@/lib/db/task-comments";
import { getVisibleTask } from "@/lib/db/tasks";
import { log } from "@/lib/log";
import type { ServiceContext } from "@/lib/service/actor";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { isTaskCommentsEnabled, isTasksEnabled } from "@/lib/tasks/config";
import { CommentBodyInput } from "./schemas";

/**
 * Comments on a task, gated by exactly what opens the task itself: whatever
 * `getVisibleTask` admits, which is clearance or recorded attendance. There is
 * no role check and no assignee narrowing. If you can read the task you can read
 * and write its thread.
 *
 * Authorship is the second gate, and it is asymmetric on purpose: an author may
 * rewrite their own comment, an administrator may remove anybody's, and nobody
 * may rewrite somebody else's and leave it attributed to them.
 */

const GONE = () => err("not_found");

/** The shared front half: flags, then the task. Returns null when the caller is through. */
function blocked(ctx: ServiceContext, taskId: string): ServiceResult<never> | null {
  if (!isTasksEnabled() || !isTaskCommentsEnabled()) return GONE();
  return getVisibleTask(ctx.db, taskId, ctx.actor.email, ctx.actor.clearance) ? null : GONE();
}

export function listTaskComments(
  ctx: ServiceContext,
  taskId: string,
): ServiceResult<{ comments: TaskComment[] }> {
  const stop = blocked(ctx, taskId);
  if (stop) return stop;
  return ok({ comments: listComments(ctx.db, taskId) });
}

export function addTaskComment(
  ctx: ServiceContext,
  taskId: string,
  raw: unknown,
  now: string = new Date().toISOString(),
): ServiceResult<{ comment: TaskComment }> {
  if (!isTasksEnabled() || !isTaskCommentsEnabled()) return GONE();

  const parsed = CommentBodyInput.safeParse(raw);
  if (!parsed.success) {
    log.info("task comment rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "body" });
  }
  const body = parsed.data.body.trim();
  if (body === "") return err("invalid_request", { detail: "body" });

  // No await between resolving the task and writing, so clearance revoked
  // in flight is honored rather than raced.
  if (!getVisibleTask(ctx.db, taskId, ctx.actor.email, ctx.actor.clearance)) return GONE();
  const comment = addComment(ctx.db, {
    id: randomUUID(),
    taskId,
    authorEmail: ctx.actor.email,
    body,
    createdAt: now,
  });
  return ok({ comment });
}

export function editTaskComment(
  ctx: ServiceContext,
  taskId: string,
  commentId: string,
  raw: unknown,
  now: string = new Date().toISOString(),
): ServiceResult<{ changed: true }> {
  if (!isTasksEnabled() || !isTaskCommentsEnabled()) return GONE();

  // Before the gate, deliberately: a malformed body answers identically for
  // every id, so refusing it early tells a caller nothing they did not already
  // know. The EMPTY-body check below is the one that has to wait.
  const parsed = CommentBodyInput.safeParse(raw);
  if (!parsed.success) {
    log.info("task comment edit rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "body" });
  }
  const body = parsed.data.body.trim();

  const stop = blocked(ctx, taskId);
  if (stop) return stop;
  const comment = getComment(ctx.db, commentId, taskId);
  if (!comment) return GONE();

  // After the gate, so a bad-request versus not-found difference on an empty
  // body cannot be used to probe which comment ids exist.
  if (body === "") return err("invalid_request", { detail: "body" });
  // Editing is the author's right alone.
  if (comment.authorEmail !== ctx.actor.email) return err("needs_role", { detail: "author" });

  const edited = editComment(ctx.db, {
    id: commentId,
    taskId,
    authorEmail: ctx.actor.email,
    body,
    editedAt: now,
  });
  return edited ? ok({ changed: true }) : GONE();
}

export function deleteTaskComment(
  ctx: ServiceContext,
  taskId: string,
  commentId: string,
): ServiceResult<{ changed: true }> {
  const stop = blocked(ctx, taskId);
  if (stop) return stop;
  const comment = getComment(ctx.db, commentId, taskId);
  if (!comment) return GONE();

  const isAuthor = comment.authorEmail === ctx.actor.email;
  if (!isAuthor && !ctx.actor.can("manageAccess")) return err("needs_role", { detail: "author" });

  // A null author drops the author clause for the administrator path while the
  // statement stays scoped by task id, so an admin still cannot reach across
  // tasks with a borrowed comment id.
  const deleted = deleteComment(ctx.db, {
    id: commentId,
    taskId,
    authorEmail: isAuthor ? ctx.actor.email : null,
  });
  return deleted ? ok({ changed: true }) : GONE();
}
