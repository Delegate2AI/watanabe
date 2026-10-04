import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { getDocForOwner, getVersions } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { promotionStatuses } from "@/lib/canvas/promote";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { isArtifactsEnabled } from "@/lib/artifacts/config";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Foreign, unknown, and flag-off all share this 404 (no existence oracle). */
const NOT_FOUND = () => fail("not_found");

/**
 * GET /api/chat-docs/[id] -> one chat document, all its versions, and its
 * per-target promotion status (spec 29): what the canvas pane renders.
 *
 * Owner-scoped: `getDocForOwner` returns null for a foreign OR unknown id, both
 * mapping to the SAME 404 (no existence oracle). The `flags` block tells the pane
 * which Promote targets to offer (a target whose flag is off is hidden), while
 * preview/copy/download work regardless. Flag-off is a 404, keeping it dark.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isCanvasEnabled()) return NOT_FOUND();
  const { id } = await params;
  const owner = auth.identity.email;

  try {
    const doc = getDocForOwner(getDb(), id, owner);
    // Source-thread ownership is the authority (defense in depth: the store
    // already scopes by it). A doc whose source thread is foreign or unknown
    // returns the IDENTICAL 404 as a missing doc (no existence oracle).
    if (!doc || !isOwnedBy(getDb(), doc.threadId, owner)) return NOT_FOUND();
    return Response.json({
      doc,
      versions: getVersions(getDb(), id, owner),
      promotions: promotionStatuses(getDb(), id, owner),
      flags: { artifactsEnabled: isArtifactsEnabled(), sharedDocsEnabled: isSharedDocsEnabled() },
    });
  } catch (e) {
    log.error("chat-docs request failed", { route: "GET /api/chat-docs/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}
