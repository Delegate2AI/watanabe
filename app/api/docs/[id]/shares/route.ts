import { z } from "zod";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { getDb } from "@/lib/db/client";
import { listShares, upsertShare, removeShare } from "@/lib/db/shared-docs";
import { validateShareTarget, type ShareTargetRejection } from "@/lib/shared-docs/share-target";
import { canRead, canManage } from "@/lib/shared-docs/access";
import { authorizeDoc, notFound } from "@/lib/shared-docs/authorize";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The share manager (spec 28), owner-only. Every method resolves access through
 * the one ACL seam: "none" (stranger OR unknown id) is a 404 (no oracle); a
 * recipient who can read but is not the owner gets 403 (managing shares is the
 * owner's alone, and they already know the doc exists so 403 leaks nothing).
 */

const forbidden = () => fail("needs_role", { detail: "owner" });

/**
 * A recipient is either one person (an address) or one team (a `groups.yaml`
 * key). `kind` defaults to "user" so a body predating team sharing still parses
 * to exactly what it always meant. A group key is only shape-checked here;
 * whether it EXISTS and whether this sharer may grant it is
 * `validateShareTarget`'s call, because both answers need the access registry.
 */
const Recipient = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), recipient: z.string().trim().email() }),
  z.object({ kind: z.literal("group"), recipient: z.string().trim().min(1).max(64) }),
]);
const withDefaultKind = (raw: unknown) =>
  typeof raw === "object" && raw !== null && !("kind" in raw) ? { ...raw, kind: "user" } : raw;

const AddBody = z.preprocess(
  withDefaultKind,
  z.intersection(Recipient, z.object({ access: z.enum(["view", "comment", "edit"]) })),
);
const RevokeBody = z.preprocess(withDefaultKind, Recipient);

/** Why a target was refused, as the error detail the client already renders. */
const REJECTION_DETAIL: Record<ShareTargetRejection, string> = {
  self: "self",
  group_sharing_off: "group_sharing_off",
  unknown_group: "unknown_group",
  group_not_in_clearance: "group_not_in_clearance",
};

/** GET -> the doc's share rows (owner only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbidden();
  try {
    return Response.json({ shares: listShares(getDb(), id) });
  } catch (e) {
    log.error("shared-docs request failed", { route: "GET /api/docs/[id]/shares", status: 500, err: String(e) });
    return fail("internal");
  }
}

/** POST -> add or update a recipient's access (owner only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbidden();

  let parsed: z.infer<typeof AddBody>;
  try {
    parsed = AddBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "POST /api/docs/[id]/shares", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }
  // Managing shares is owner-only, so the manager IS the owner: a self-share, an
  // undeclared group, or a group this owner is not cleared for are all refused
  // here, in one seam shared with the picker that offers the options.
  const target = validateShareTarget(parsed, authz.identity.email);
  if (!target.ok) {
    log.info("shared-docs request rejected", {
      route: "POST /api/docs/[id]/shares",
      reason: target.reason,
      kind: parsed.kind,
      owner: authz.identity.email,
    });
    return fail("invalid_request", { detail: REJECTION_DETAIL[target.reason] });
  }
  try {
    upsertShare(getDb(), id, parsed.recipient, parsed.access, new Date().toISOString(), parsed.kind);
    captureServerEvent("doc_shared", {
      distinctId: analyticsIdFor(authz.identity.email),
      properties: { kind: parsed.kind, access: parsed.access },
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", { route: "POST /api/docs/[id]/shares", status: 500, err: String(e) });
    return fail("internal");
  }
}

/** DELETE -> revoke a recipient's share (owner only). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbidden();

  let parsed: z.infer<typeof RevokeBody>;
  try {
    parsed = RevokeBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "DELETE /api/docs/[id]/shares", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    // Deliberately NOT gated on validateShareTarget: revoking must keep working
    // for a target that is no longer valid to grant (a group dropped from
    // groups.yaml, or one the owner has since left). Otherwise a stale grant
    // becomes permanently un-removable through the UI.
    removeShare(getDb(), id, parsed.recipient, parsed.kind);
    return Response.json({ ok: true });
  } catch (e) {
    log.error("shared-docs request failed", { route: "DELETE /api/docs/[id]/shares", status: 500, err: String(e) });
    return fail("internal");
  }
}
