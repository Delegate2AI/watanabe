import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { getSession } from "@/lib/agent/session";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  decision: z.enum(["allow", "allow_always", "deny"]),
});

/**
 * Resolve a pending `kb_submit` confirmation (see `AgentSession.canUseTool` /
 * `resolvePermission` in `lib/agent/session.ts`) — the write path's confirm
 * tier. This was an inert 501 stub through Phase 1 (no write tools existed to
 * gate); it's a real endpoint now that `lib/agent/permissions.ts`'s gate can
 * return `"confirm"` for `kb_submit`.
 *
 * Ownership is checked BEFORE the session is even looked up — the same
 * `isOwnedBy` check `POST /api/agent` uses — so a non-owner who guesses or
 * observes a `sessionId`+`requestId` pair can never resolve someone else's
 * confirmation. `sessionId` here is unowned-is-forbidden (`isOwnedBy`, not
 * the looser `checkOwnership`), matching `POST /api/agent`'s posture for a
 * content-bearing action.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "POST /api/agent/permission", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/permission",
      status: 400,
      reason: "invalid body",
      owner: identity.email,
      err: String(e),
    });
    return fail("invalid_request", { detail: "body" });
  }

  if (!isOwnedBy(getDb(), parsed.sessionId, identity.email)) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/permission",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_cleared");
  }

  // In-memory lookup only, deliberately: a permission request only ever
  // exists on a warm subprocess (it's mid-turn, holding a live `canUseTool`
  // call open) — if the session was evicted, its `dispose()` already
  // auto-denied any pending confirmations, so there is nothing left to
  // resolve regardless.
  const session = getSession(parsed.sessionId);
  if (!session) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/permission",
      status: 404,
      reason: "no live session",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_found");
  }

  const resolved = session.resolvePermission(parsed.requestId, parsed.decision);
  if (!resolved) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/permission",
      status: 404,
      reason: "unknown or already-resolved requestId",
      owner: identity.email,
      sessionId: parsed.sessionId,
      requestId: parsed.requestId,
    });
    return fail("not_found");
  }

  log.info("permission resolved", {
    route: "POST /api/agent/permission",
    owner: identity.email,
    sessionId: parsed.sessionId,
    requestId: parsed.requestId,
    decision: parsed.decision,
  });
  return Response.json({ ok: true });
}
