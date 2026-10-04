import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { actorFor } from "@/lib/service/actor";
import { respond } from "@/lib/service/http";
import { deleteTaskComment, editTaskComment } from "@/lib/tasks/service/comments";
import { isTaskCommentsEnabled, isTasksEnabled } from "@/lib/tasks/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Adapters over the comment service. The two handlers resolve identity at
 * different points, and that asymmetry is deliberate and preserved from the
 * handler this replaces: PATCH settles the flags before anything else so that
 * flag-off answers not-found for every body, malformed or not, while DELETE
 * settles identity first and therefore answers a 401 to an unauthenticated
 * caller whatever the flags say. No test covers the crossing case, and moving
 * either would be a behavior change inside a refactor.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  // Synchronously, before the body is even read. The service checks the same
  // pair again; the repeat costs nothing and keeps this ordering explicit at the
  // surface that has to guarantee it.
  if (!isTasksEnabled() || !isTaskCommentsEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { id, commentId } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }

  try {
    const ctx = { db: getDb(), actor: actorFor(auth.identity.email) };
    return respond(editTaskComment(ctx, id, commentId, raw), () => Response.json({ ok: true }));
  } catch (error) {
    log.error("task comments request failed", {
      route: "PATCH /api/tasks/[id]/comments/[commentId]", error: String(error),
    });
    return fail("internal");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { id, commentId } = await params;

  try {
    const ctx = { db: getDb(), actor: actorFor(auth.identity.email) };
    return respond(deleteTaskComment(ctx, id, commentId), () => Response.json({ ok: true }));
  } catch (error) {
    log.error("task comments request failed", {
      route: "DELETE /api/tasks/[id]/comments/[commentId]", error: String(error),
    });
    return fail("internal");
  }
}
