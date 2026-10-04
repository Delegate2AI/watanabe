import { z } from "zod";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { getDb } from "@/lib/db/client";
import { upsertShare } from "@/lib/db/shared-docs";
import { decideRequest, getRequest } from "@/lib/db/doc-access-requests";
import { accessFor, canRead, canManage } from "@/lib/shared-docs/access";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { notFound, requireEnabledIdentity } from "@/lib/shared-docs/authorize";
import { isDocAccessRequestsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Answering one access request, owner-only.
 *
 * Granting writes a `doc_shares` row and marks the request granted, in that
 * order and in one transaction: a request marked granted with no share row is
 * an ask nobody will ever see again on a document the person still cannot open.
 *
 * The granted level is the OWNER's, defaulting to what was asked for. An owner
 * who wants to answer a request for edit with view access must be able to,
 * otherwise the requester picks their own privilege.
 */

const forbidden = () => fail("needs_role", { detail: "owner" });

const DecisionBody = z.object({
  decision: z.enum(["granted", "declined"]),
  /** Overrides the requested level on a grant. Ignored on a decline. */
  access: z.enum(["view", "comment", "edit"]).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
): Promise<Response> {
  const { id, rid } = await params;
  if (!isDocAccessRequestsEnabled()) return notFound();
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;

  let parsed: z.infer<typeof DecisionBody>;
  try {
    parsed = DecisionBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", {
      route: "POST /api/docs/[id]/access-requests/[rid]",
      err: String(e),
    });
    return fail("invalid_request", { detail: "body" });
  }

  // Re-resolved AFTER the body parse, so ownership cannot have been handed off
  // during the await: the same TOCTOU close every mutating doc route makes.
  const email = gate.identity.email;
  const access = accessFor(getDb(), id, email, shareClearanceFor(email));
  if (!canRead(access)) return notFound();
  if (!canManage(access)) return forbidden();

  const existing = getRequest(getDb(), id, rid);
  if (!existing) return notFound();
  // Already answered: report the conflict rather than re-deciding, so a stale
  // panel cannot silently overwrite who decided it and when.
  if (existing.status !== "pending") return fail("conflict");

  const granted = parsed.access ?? existing.access;
  try {
    getDb().transaction(() => {
      if (!decideRequest(getDb(), id, rid, parsed.decision, email)) return;
      if (parsed.decision === "granted") {
        upsertShare(getDb(), id, existing.requesterEmail, granted);
      }
    })();
    captureServerEvent("doc_access_decided", {
      distinctId: analyticsIdFor(email),
      properties: { decision: parsed.decision, access: parsed.decision === "granted" ? granted : null },
    });
    return Response.json({ ok: true });
  } catch (e) {
    log.error("shared-docs request failed", {
      route: "POST /api/docs/[id]/access-requests/[rid]",
      status: 500,
      err: String(e),
    });
    return fail("internal");
  }
}
