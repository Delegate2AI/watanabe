import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { actorFor } from "@/lib/service/actor";
import { respond } from "@/lib/service/http";
import { createTask, listTasks } from "@/lib/tasks/service/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Both handlers are adapters: resolve identity, build the actor, hand the raw
 * input to the service, render what comes back. Every rule about who may see or
 * create a task lives in `lib/tasks/service/tasks.ts`, where the MCP tools call
 * the same function.
 *
 * `requireIdentity` stays here rather than moving into the adapter. Its 401 is
 * `{ error: "<sentence>" }`, a different shape from the failure contract's
 * `{ error: { code } }`, so returning it untouched is what keeps every route's
 * unauthenticated response byte-identical.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;

  try {
    return respond(listTasks({ db: getDb(), actor: actorFor(auth.identity.email) }));
  } catch (error) {
    log.error("tasks request failed", { route: "GET /api/tasks", error: String(error) });
    return fail("internal");
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;

  // An unreadable body reaches the service as `undefined` and is refused by the
  // same schema that refuses a well-formed but invalid one, so a broken payload
  // and a wrong one answer alike.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }

  try {
    const ctx = { db: getDb(), actor: actorFor(auth.identity.email) };
    return respond(createTask(ctx, raw), (value) => Response.json(value, { status: 201 }));
  } catch (error) {
    log.error("tasks request failed", { route: "POST /api/tasks", error: String(error) });
    return fail("internal");
  }
}
