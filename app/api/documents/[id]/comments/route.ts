import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { accessFor, canComment, canRead } from "@/lib/documents/access";
import { addComment, listComments, removeComment } from "@/lib/documents/store";
import { log } from "@/lib/log";
import { authorizeDocument, notFound, requireEnabledIdentity } from "../../authorize";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AddBody = z.object({
  body: z.string().min(1).refine((value) => value.trim() !== "", "comment is empty"),
  anchor: z.string().trim().min(1).max(200).optional(),
});
const RemoveBody = z.object({ id: z.string().min(1) });
const forbidden = () => fail("needs_role", { detail: "comment" });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDocument(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canComment(authz.access)) return forbidden();
  try {
    return Response.json({ comments: listComments(getDb(), id) });
  } catch (error) {
    log.error("documents request failed", { route: "GET /api/documents/[id]/comments", status: 500, err: String(error) });
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
    log.info("documents request rejected", { route: "POST /api/documents/[id]/comments", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canComment(access)) return forbidden();
    addComment(db, {
      id: randomUUID(),
      docId: id,
      authorEmail: gate.identity.email,
      body: parsed.body,
      anchor: parsed.anchor ?? null,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    log.error("documents request failed", { route: "POST /api/documents/[id]/comments", status: 500, err: String(error) });
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
    log.info("documents request rejected", { route: "DELETE /api/documents/[id]/comments", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }
  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canComment(access)) return forbidden();
    removeComment(db, id, parsed.id);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("documents request failed", { route: "DELETE /api/documents/[id]/comments", status: 500, err: String(error) });
    return fail("internal");
  }
}
