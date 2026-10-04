import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { listSuggestions } from "@/lib/db/suggestions";
import { proposeSuggestion } from "@/lib/shared-docs/propose-suggestion";
import { accessFor, canRead, canComment } from "@/lib/shared-docs/access";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { authorizeDoc, requireEnabledIdentity, notFound } from "@/lib/shared-docs/authorize";
import { isDocAnnotationsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proposed edits (suggestions, spec 2026-07-22), for comment/edit access. List
 * and create only; accept/reject live on `[sid]/route.ts` since they require
 * edit access, a different tier than create/list. Flag-off (or the shared-docs
 * flag off) is the shared 404 (no oracle).
 */

const forbidden = () => fail("needs_role", { detail: "comment" });

const anchorSchema = z.object({
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  start: z.number().int().nonnegative(),
});
const CreateBody = z.object({
  anchor: anchorSchema,
  proposedText: z.string(),
  note: z.string().trim().max(2000).optional(),
});

/** GET -> pending + resolved suggestions on the doc (comment/edit access). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isDocAnnotationsEnabled()) return notFound();
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canComment(authz.access)) return forbidden();
  try {
    return Response.json({ suggestions: listSuggestions(getDb(), id) });
  } catch (e) {
    log.error("shared-docs request failed", { route: "GET /api/docs/[id]/suggestions", status: 500, err: String(e) });
    return fail("internal");
  }
}

/**
 * POST -> propose an edit (comment/edit access). Flag check FIRST (before
 * identity or body parsing) so flag-off is a uniform 404, never a 401 or
 * 400. TOCTOU-safe: identity next, THEN parse the body (async), THEN
 * re-resolve the ACL synchronously immediately before the write, matching
 * the comments route's convention.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isDocAnnotationsEnabled()) return notFound();
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });
  try {
    const db = getDb();
    // With team clearance, matching `authorizeDoc`: a group-shared commenter
    // may propose, not only per-address shares.
    const access = accessFor(db, id, gate.identity.email, shareClearanceFor(gate.identity.email));
    if (!canRead(access)) return notFound();
    if (!canComment(access)) return forbidden();
    // The core re-locates the quote in the CURRENT body server-side and
    // refuses anything but a single contiguous match (see propose-suggestion).
    const outcome = proposeSuggestion(db, {
      docId: id,
      anchor: parsed.data.anchor,
      proposedText: parsed.data.proposedText,
      note: parsed.data.note ?? null,
      createdBy: gate.identity.email,
      via: null,
    });
    if (!outcome.ok) return fail("invalid_request", { detail: "anchor" });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", { route: "POST /api/docs/[id]/suggestions", status: 500, err: String(e) });
    return fail("internal");
  }
}
