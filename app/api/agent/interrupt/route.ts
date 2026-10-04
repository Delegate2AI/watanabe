import { z } from "zod";
import { getSession } from "@/lib/agent/session";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ sessionId: z.string().uuid() });

/**
 * Interrupt the current turn: the agent stops and goes idle, awaiting input.
 *
 * STRICT ownership: the caller must own the thread (`isOwnedBy`), and a foreign
 * id AND an unknown id both return the SAME 404. This closes two holes the prior
 * `checkOwnership` shape left open: (1) an existence oracle (foreign 403 vs
 * unknown 200), and (2) an unknown id reaching the global warm-session map,
 * which could interrupt another user's running turn if the ownership DB row was
 * ever missing (a failed persistence write). An OWNED but cold/evicted session
 * is a graceful no-op (nothing warm to stop), not an error.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "POST /api/agent/interrupt", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/interrupt",
      status: 400,
      reason: "invalid body",
      owner: identity.email,
      err: String(e),
    });
    return fail("invalid_request", { detail: "body" });
  }

  if (!isOwnedBy(getDb(), parsed.sessionId, identity.email)) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/interrupt",
      status: 404,
      reason: "not found or not owned",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_found");
  }

  const session = getSession(parsed.sessionId);
  if (!session) {
    return Response.json({ ok: true, interrupted: false });
  }
  await session.interrupt();
  return Response.json({ ok: true, interrupted: true });
}
