import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { getSharedDoc, latestBody, getVersions, addVersion, latestVersionOf, renameSharedDoc } from "@/lib/db/shared-docs";
import { accessFor, canRead, canEdit, canManage } from "@/lib/shared-docs/access";
import { authorizeDoc, requireEnabledIdentity, notFound } from "@/lib/shared-docs/authorize";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/docs/[id] -> the doc, its CURRENT body, and the caller's effective
 * access. ACL-gated (spec 28): resolved through `accessFor`; "none" (a stranger
 * OR an unknown id) returns the SAME 404 as a flag-off route, so there is no
 * existence oracle.
 *
 * Version history (bodies + author emails) is owner-only disclosure (finding 2):
 * a view/comment/edit recipient receives the current body only, never prior
 * versions or who authored them. `versions` is present only for the owner.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();

  try {
    const doc = getSharedDoc(getDb(), id);
    if (!doc) return notFound();
    return Response.json({
      doc: { id: doc.id, title: doc.title, ownerEmail: doc.ownerEmail, updatedAt: doc.updatedAt },
      access: authz.access,
      body: latestBody(getDb(), id) ?? "",
      ...(canManage(authz.access) ? { versions: getVersions(getDb(), id) } : {}),
    });
  } catch (e) {
    log.error("shared-docs request failed", { route: "GET /api/docs/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}

const PatchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().min(1).optional(),
});

/**
 * PATCH /api/docs/[id] -> edit the body (appends a version, edit access) and/or
 * rename (owner only). The new version is authored under the caller.
 *
 * TOCTOU-safe (finding 3): identity + flag are checked, THEN the body is parsed
 * (the async step), THEN the ACL is re-resolved synchronously and the capability
 * check and the write happen with no await between them. Access revoked or
 * downgraded while the body was in flight is therefore honored. "none" -> 404
 * (no oracle); readable-but-insufficient -> 403 (existence already known).
 * Only the current body is returned (no history disclosure, finding 2).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;
  const { identity } = gate;

  let parsed: z.infer<typeof PatchBody>;
  try {
    parsed = PatchBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "PATCH /api/docs/[id]", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    // Re-resolve the ACL HERE, after the body is fully read, and gate + write
    // without yielding, so a mid-request revoke/downgrade cannot slip through.
    const db = getDb();
    const access = accessFor(db, id, identity.email);
    if (!canRead(access)) return notFound();
    if (parsed.body !== undefined && !canEdit(access)) {
      return fail("needs_role", { detail: "edit" });
    }
    if (parsed.title !== undefined && !canManage(access)) {
      return fail("needs_role", { detail: "owner" });
    }
    // The format carries forward. An edit that dropped it would relabel a
    // designed page as markdown, and the markdown renderer discards raw HTML
    // rather than printing it, so the next read would be an empty document.
    if (parsed.body !== undefined) {
      addVersion(db, id, identity.email, parsed.body, { format: latestVersionOf(db, id)?.format });
    }
    if (parsed.title !== undefined) renameSharedDoc(db, id, identity.email, parsed.title);

    const doc = getSharedDoc(db, id);
    return Response.json({ title: doc?.title ?? "", access, body: latestBody(db, id) ?? "" });
  } catch (e) {
    log.error("shared-docs request failed", { route: "PATCH /api/docs/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}
