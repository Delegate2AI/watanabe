import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { insertLink, listLinks, removeLink } from "@/lib/db/shared-docs";
import { canRead, canManage } from "@/lib/shared-docs/access";
import { authorizeDoc, notFound } from "@/lib/shared-docs/authorize";
import { isExternalShareEnabled } from "@/lib/shared-docs/config";
import { newLinkToken, computeExpiry, MAX_LINK_TTL_HOURS } from "@/lib/shared-docs/links";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * External signed-link management (spec 28), owner-only, and additionally gated
 * by `EXTERNAL_SHARE_ENABLED`. Off, this is a 404 dark surface so no link can be
 * minted, listed, or revoked. The token is view|comment ONLY (the schema in the
 * body rejects "edit"), always expiring, and individually revocable.
 */

const forbidden = () => fail("needs_role", { detail: "owner" });

// Note: no "edit". An external link can NEVER grant edit access.
const MintBody = z.object({
  access: z.enum(["view", "comment"]),
  expiresInHours: z.number().int().min(1).max(MAX_LINK_TTL_HOURS).optional(),
});
const RevokeBody = z.object({ token: z.string().min(1) });

/** Resolve owner authorization for a link operation, or a ready Response. */
async function requireOwner(
  request: Request,
  id: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!isExternalShareEnabled()) return { ok: false, response: notFound() };
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return { ok: false, response: authz.response };
  if (!canRead(authz.access)) return { ok: false, response: notFound() };
  if (!canManage(authz.access)) return { ok: false, response: forbidden() };
  return { ok: true };
}

/** GET -> active links on the doc (owner only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const guard = await requireOwner(request, id);
  if (!guard.ok) return guard.response;
  try {
    return Response.json({ links: listLinks(getDb(), id) });
  } catch (e) {
    log.error("shared-docs request failed", { route: "GET /api/docs/[id]/links", status: 500, err: String(e) });
    return fail("internal");
  }
}

/** POST -> mint a view|comment link with a strong token and an expiry (owner only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const guard = await requireOwner(request, id);
  if (!guard.ok) return guard.response;

  let parsed: z.infer<typeof MintBody>;
  try {
    parsed = MintBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "POST /api/docs/[id]/links", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const token = newLinkToken();
    const expiresAt = computeExpiry(new Date(), parsed.expiresInHours);
    insertLink(getDb(), { token, docId: id, access: parsed.access, expiresAt });
    return Response.json({ token, access: parsed.access, expiresAt }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", { route: "POST /api/docs/[id]/links", status: 500, err: String(e) });
    return fail("internal");
  }
}

/** DELETE -> revoke a link by token (owner only). A revoked token then 404s. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const guard = await requireOwner(request, id);
  if (!guard.ok) return guard.response;

  let parsed: z.infer<typeof RevokeBody>;
  try {
    parsed = RevokeBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "DELETE /api/docs/[id]/links", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    // Scoped to THIS doc id: an owner of another doc cannot revoke this doc's
    // link, and vice versa, even if they present a foreign token (finding 1).
    removeLink(getDb(), id, parsed.token);
    return Response.json({ ok: true });
  } catch (e) {
    log.error("shared-docs request failed", { route: "DELETE /api/docs/[id]/links", status: 500, err: String(e) });
    return fail("internal");
  }
}
