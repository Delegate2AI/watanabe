import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { accessFor, canManage, canRead } from "@/lib/documents/access";
import { listShares, removeShare, upsertShare } from "@/lib/documents/store";
import { log } from "@/lib/log";
import { authorizeDocument, notFound, requireEnabledIdentity } from "../../authorize";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AddBody = z.object({
  recipientEmail: z.string().trim().email(),
  access: z.enum(["view", "comment", "edit"]),
});
const RemoveBody = z.object({ recipientEmail: z.string().trim().email() });
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
    return Response.json({ shares: listShares(getDb(), id) });
  } catch (error) {
    log.error("documents request failed", { route: "GET /api/documents/[id]/shares", status: 500, err: String(error) });
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
    log.info("documents request rejected", { route: "POST /api/documents/[id]/shares", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canManage(access)) return forbidden();
    upsertShare(db, id, parsed.recipientEmail, parsed.access);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    log.error("documents request failed", { route: "POST /api/documents/[id]/shares", status: 500, err: String(error) });
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
    log.info("documents request rejected", { route: "DELETE /api/documents/[id]/shares", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canManage(access)) return forbidden();
    removeShare(db, id, parsed.recipientEmail);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("documents request failed", { route: "DELETE /api/documents/[id]/shares", status: 500, err: String(error) });
    return fail("internal");
  }
}
