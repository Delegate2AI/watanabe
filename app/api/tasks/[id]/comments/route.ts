import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { actorFor } from "@/lib/service/actor";
import { respond } from "@/lib/service/http";
import { addTaskComment, listTaskComments } from "@/lib/tasks/service/comments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Adapters over the comment service, which owns the gate: whatever opens the
 * task opens its thread.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    return respond(listTaskComments({ db: getDb(), actor: actorFor(auth.identity.email) }, id));
  } catch (error) {
    log.error("task comments request failed", {
      route: "GET /api/tasks/[id]/comments", error: String(error),
    });
    return fail("internal");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }

  try {
    const ctx = { db: getDb(), actor: actorFor(auth.identity.email) };
    return respond(addTaskComment(ctx, id, raw), (value) => Response.json(value, { status: 201 }));
  } catch (error) {
    log.error("task comments request failed", {
      route: "POST /api/tasks/[id]/comments", error: String(error),
    });
    return fail("internal");
  }
}
