import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { checkDraftAccess } from "@/lib/agent/draft-access";
import { fail } from "@/lib/errors/codes";
import { discard } from "@/lib/repo-write";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ sessionId: z.string().min(1) });

/**
 * POST /api/agent/draft/discard { sessionId } -> { ok: true }
 *
 * Spec 12 D27 — the ONLY mutating draft-view endpoint; everything else the
 * draft view does is a read. The vault page's `DraftBanner` gates the call
 * behind a browser-native `confirm()` before it's ever sent; this route
 * re-validates ownership+shape server-side regardless, same posture as
 * `POST /api/agent/permission`. `"own-but-gone"` is treated as an idempotent
 * success — discarding an already-discarded/submitted draft is a no-op, not
 * an error.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/draft/discard",
      status: 401,
      reason: "unauthorized",
    });
    return auth.response;
  }
  const { identity } = auth;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  const access = checkDraftAccess(getDb(), parsed.sessionId, identity.email);
  if (access === "invalid-or-forbidden") {
    log.warn("agent request rejected", {
      route: "POST /api/agent/draft/discard",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_cleared");
  }
  if (access === "own-but-gone") {
    return Response.json({ ok: true });
  }

  await discard(parsed.sessionId);
  log.info("draft discarded", {
    route: "POST /api/agent/draft/discard",
    owner: identity.email,
    sessionId: parsed.sessionId,
  });
  return Response.json({ ok: true });
}
