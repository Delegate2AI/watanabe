import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { accessFor, canManage, canRead } from "@/lib/documents/access";
import { addLink, listLinks, removeLink } from "@/lib/documents/store";
import { computeExpiry, MAX_LINK_TTL_HOURS, newLinkToken } from "@/lib/shared-docs/links";
import { log } from "@/lib/log";
import { authorizeDocument, notFound, requireEnabledIdentity } from "../../authorize";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AddBody = z.object({
  access: z.enum(["view", "comment"]),
  expiresInHours: z.number().int().min(1).max(MAX_LINK_TTL_HOURS).optional(),
});
const RemoveBody = z.object({ token: z.string().min(1) });
const forbidden = () => fail("needs_role", { detail: "owner" });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDocument(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbidden();
  try {
    return Response.json({ links: listLinks(getDb(), id) });
  } catch (error) {
    log.error("documents request failed", { route: "GET /api/documents/[id]/links", status: 500, err: String(error) });
    return fail("internal");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;
  let parsed: z.infer<typeof AddBody>;
  try {
    parsed = AddBody.parse(await request.json());
  } catch (error) {
    log.info("documents request rejected", { route: "POST /api/documents/[id]/links", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canManage(access)) return forbidden();
    const token = newLinkToken();
    const expiresAt = computeExpiry(new Date(), parsed.expiresInHours);
    addLink(db, { token, docId: id, access: parsed.access, expiresAt });
    return Response.json({ token, access: parsed.access, expiresAt }, { status: 201 });
  } catch (error) {
    log.error("documents request failed", { route: "POST /api/documents/[id]/links", status: 500, err: String(error) });
    return fail("internal");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;
  let parsed: z.infer<typeof RemoveBody>;
  try {
    parsed = RemoveBody.parse(await request.json());
  } catch (error) {
    log.info("documents request rejected", { route: "DELETE /api/documents/[id]/links", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canManage(access)) return forbidden();
    removeLink(db, id, parsed.token);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("documents request failed", { route: "DELETE /api/documents/[id]/links", status: 500, err: String(error) });
    return fail("internal");
  }
}
