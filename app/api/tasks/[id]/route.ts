import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { actorFor } from "@/lib/service/actor";
import { respond } from "@/lib/service/http";
import { getTask } from "@/lib/tasks/service/tasks";
import { transitionTask } from "@/lib/tasks/service/transitions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Adapters over the task service. Every rule about who may read a task and which
 * state changes they may make lives in `lib/tasks/service/`, where the MCP tools
 * call the same two functions.
 *
 * Note the wire body on a successful PATCH stays `{ ok: true }`. The service
 * reports `{ changed: true }`, which says something slightly different and is
 * what the tools render; the renderer keeps the HTTP contract as it was.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { id } = await params;

  try {
    return respond(getTask({ db: getDb(), actor: actorFor(auth.identity.email) }, id));
  } catch (error) {
    log.error("tasks request failed", { route: "GET /api/tasks/[id]", error: String(error) });
    return fail("internal");
  }
}

export async function PATCH(
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
    return respond(transitionTask(ctx, id, raw), () => Response.json({ ok: true }));
  } catch (error) {
    log.error("tasks request failed", { route: "PATCH /api/tasks/[id]", error: String(error) });
    return fail("internal");
  }
}
