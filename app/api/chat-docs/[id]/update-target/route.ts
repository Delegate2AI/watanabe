import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { getDocForOwner } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { STATUS, fail } from "@/lib/errors/codes";
import { updateTarget } from "@/lib/canvas/promote";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Foreign, unknown, and flag-off all share this 404 (no existence oracle). */
const NOT_FOUND = () => fail("not_found");

const Body = z.object({
  target: z.enum(["artifact", "shared_doc"]),
  confirm: z.boolean().optional(),
});

/**
 * POST /api/chat-docs/[id]/update-target -> push the chat document's current
 * version as a NEW version of a promoted target (spec 29). Additive: it appends,
 * so no target edit is ever destroyed.
 *
 * Divergence is never silent. When the target moved independently since the
 * promotion and the caller did not pass `confirm: true`, this returns 409 with
 * the classification so the pane can name the divergence ("now at v4, you
 * promoted v2") before the user confirms. `up_to_date` (nothing newer than the
 * last promotion) is a 409 too. Owner-scoped: a foreign or unknown id 404s.
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
    const result = updateTarget(getDb(), { docId: id, ownerEmail: owner, target: parsed.target, confirm: parsed.confirm });
    if (result.ok) {
      return Response.json({
        targetType: result.targetType,
        targetId: result.targetId,
        newTargetVersion: result.newTargetVersion,
        classification: result.classification,
      });
    }
    if (result.reason === "not_found") return NOT_FOUND();
    if (result.reason === "disabled") {
      return fail("invalid_request", { detail: "target" });
    }
    // up_to_date or diverged: a 409 the pane turns into "nothing to update" or a
    // confirm dialog naming the divergence. `detail` carries which of the two it
    // is (a value from a closed set, not free text), and `classification` rides
    // alongside as data the pane renders, not as copy.
    return Response.json(
      { error: { code: "conflict" as const, detail: result.reason }, classification: result.classification },
      { status: STATUS.conflict },
    );
  } catch (e) {
    log.error("chat-docs request failed", { route: "POST /api/chat-docs/[id]/update-target", status: 500, err: String(e) });
    return fail("internal");
  }
}
