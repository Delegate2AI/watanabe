import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { getDocForOwner } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { promote } from "@/lib/canvas/promote";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Foreign, unknown, and flag-off all share this 404 (no existence oracle). */
const NOT_FOUND = () => fail("not_found");

const Body = z.object({ target: z.enum(["artifact", "shared_doc"]) });

/**
 * POST /api/chat-docs/[id]/promote -> seed a spec-27 artifact or spec-28 shared
 * doc from the chat document's current version, recording the promotion (spec
 * 29). Promotion snapshots: it goes through the existing artifact/shared-doc
 * stores (a draft artifact, owner-private until separately published; a shared
 * doc), never the KB publish write path.
 *
 * Owner-scoped: `getDocForOwner` resolves ownership FIRST so a foreign or unknown
 * id both 404 (no existence oracle) before any target-flag branch. A target whose
 * flag is off is a 400 (the pane hides it, so this is a defensive backstop).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isCanvasEnabled()) return NOT_FOUND();
  const { id } = await params;
  const owner = auth.identity.email;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const doc = getDocForOwner(getDb(), id, owner);
    // Source-thread ownership is the authority (defense in depth over the store's
    // own thread-scoping): a foreign/unknown source thread 404s like a missing doc.
    if (!doc || !isOwnedBy(getDb(), doc.threadId, owner)) return NOT_FOUND();
    const result = promote(getDb(), { docId: id, ownerEmail: owner, target: parsed.target, sourceThreadId: doc.threadId });
    if (!result.ok) {
      if (result.reason === "not_found") return NOT_FOUND();
      return fail("invalid_request", { detail: "target" });
    }
    return Response.json(
      {
        targetType: result.targetType,
        targetId: result.targetId,
        promotedVersion: result.promotedVersion,
        targetVersion: result.targetVersion,
      },
      { status: 201 },
    );
  } catch (e) {
    log.error("chat-docs request failed", { route: "POST /api/chat-docs/[id]/promote", status: 500, err: String(e) });
    return fail("internal");
  }
}
