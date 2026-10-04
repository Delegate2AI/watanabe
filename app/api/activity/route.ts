import { requireIdentity } from "@/lib/auth/identity";
import { newSince } from "@/lib/activity/aggregate";
import { isActivityEnabled } from "@/lib/activity/config";
import { getCursor, markSeen } from "@/lib/db/activity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Flag-off is indistinguishable from a route that was never deployed. */
function dormant(): Response {
  return fail("not_found");
}

export async function GET(request: Request): Promise<Response> {
  if (!isActivityEnabled()) return dormant();
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  try {
    const db = getDb();
    const email = auth.identity.email.trim().toLowerCase();
    const cursor = getCursor(db, email);
    const clearance = resolveClearanceForEmail(email);
    return Response.json(newSince(db, email, clearance, cursor));
  } catch (error) {
    log.error("activity request failed", { route: "GET /api/activity", error: String(error) });
    return fail("internal", { message: "failed to list activity" });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isActivityEnabled()) return dormant();
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  try {
    const lastSeenAt = markSeen(getDb(), auth.identity.email);
    return Response.json({ lastSeenAt });
  } catch (error) {
    log.error("activity request failed", { route: "POST /api/activity/seen", error: String(error) });
    return fail("internal", { message: "failed to mark activity seen" });
  }
}
