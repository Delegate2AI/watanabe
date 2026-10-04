import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { isKbReviewEnabled } from "@/lib/review/config";
import { loadProposals } from "@/lib/review/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The proposals this approver may act on. The queue is built from GitLab and
 * clearance-filtered per requester, so an empty list and a refusal are different
 * answers: a queue GitLab could not be listed for reports 502 rather than
 * rendering as "nothing to review".
 */
export async function GET(request: Request): Promise<Response> {
  if (!isKbReviewEnabled()) return fail("not_found");
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const email = auth.identity.email;
  if (!can(email, "approve")) return fail("needs_role");

  try {
    const proposals = await loadProposals(getDb(), email);
    return Response.json({ proposals });
  } catch (error) {
    log.warn("review: could not load the proposal queue", { err: String(error) });
    return fail("review_unavailable");
  }
}
