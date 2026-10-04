import { z } from "zod";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { getDb } from "@/lib/db/client";
import { getSharedDoc } from "@/lib/db/shared-docs";
import { listPending, requestAccess } from "@/lib/db/doc-access-requests";
import { canRead, canManage } from "@/lib/shared-docs/access";
import { authorizeDoc, notFound } from "@/lib/shared-docs/authorize";
import { isDocAccessRequestsEnabled } from "@/lib/shared-docs/config";
import { rateLimit } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Access requests on a shared document (migration v33).
 *
 * POST is the one shared-doc route deliberately open to a caller with NO access
 * on the document: that is what asking for it means. It still discloses nothing
 * a stranger did not already have, because the ask is write-only from their
 * side. They cannot read the doc, its title, its owner, or anyone else's ask.
 * GET is owner-only and re-checks, like every other management surface here.
 */

const forbidden = () => fail("needs_role", { detail: "owner" });

const RequestBody = z.object({
  access: z.enum(["view", "comment", "edit"]),
  // Optional and bounded: a note to the owner, not a channel for a document.
  message: z.string().trim().max(500).optional(),
});

/** How many asks one identity may make per window, across all documents. */
const REQUEST_LIMIT = 20;
const REQUEST_WINDOW_MS = 60_000;

/** POST -> ask the owner for access. Open to a caller who cannot read the doc. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!isDocAccessRequestsEnabled()) return notFound();
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;

  // Unknown id is the same 404 every other doc route gives. Existence is only
  // ever confirmed to someone holding the id, and only through this feature.
  const doc = getSharedDoc(getDb(), id);
  if (!doc) return notFound();
  // Already in: nothing to ask for. The screen that posts this only renders for
  // a caller with no access, so this is a stale tab, and "reload" is the answer.
  if (canRead(authz.access)) return fail("conflict");

  let parsed: z.infer<typeof RequestBody>;
  try {
    parsed = RequestBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "POST /api/docs/[id]/access-requests", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }
  if (!rateLimit("doc-access-requests", authz.identity.email, REQUEST_LIMIT, REQUEST_WINDOW_MS)) {
    return fail("conflict");
  }

  try {
    const created = requestAccess(getDb(), {
      docId: id,
      requesterEmail: authz.identity.email,
      access: parsed.access,
      message: parsed.message?.length ? parsed.message : null,
    });
    captureServerEvent("doc_access_requested", {
      distinctId: analyticsIdFor(authz.identity.email),
      properties: { access: parsed.access, withMessage: created.message !== null },
    });
    return Response.json({ request: created }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", {
      route: "POST /api/docs/[id]/access-requests",
      status: 500,
      err: String(e),
    });
    return fail("internal");
  }
}

/** GET -> the document's pending asks (owner only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!isDocAccessRequestsEnabled()) return notFound();
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbidden();
  try {
    return Response.json({ requests: listPending(getDb(), id) });
  } catch (e) {
    log.error("shared-docs request failed", {
      route: "GET /api/docs/[id]/access-requests",
      status: 500,
      err: String(e),
    });
    return fail("internal");
  }
}
