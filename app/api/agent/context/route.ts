import { getSession } from "@/lib/agent/session";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { checkOwnership } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/context?id=<uuid> → current context-window usage for a warm
 * session, or `{ usage: null }` when the session isn't in memory (cold/evicted)
 * — the meter simply hides until the next turn warms it again.
 *
 * This endpoint carries no conversation content (just token counts), so an
 * `id` this store has never seen ("unowned") is left to the existing graceful
 * `{ usage: null }` path — only a CONFIRMED cross-user mismatch is refused.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "GET /api/agent/context", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ usage: null });

  if (checkOwnership(getDb(), id, identity.email) === "forbidden") {
    log.warn("agent request rejected", {
      route: "GET /api/agent/context",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId: id,
    });
    return fail("not_cleared");
  }

  const session = getSession(id);
  if (!session) return Response.json({ usage: null });

  const usage = await session.contextUsage();
  return Response.json({ usage });
}
