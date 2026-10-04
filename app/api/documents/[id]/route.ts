import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { accessFor, canEdit, canManage, canRead } from "@/lib/documents/access";
import {
  addVersion,
  deleteDocument,
  dispositionFor,
  getDocument,
  getPublication,
  listComments,
  listLinks,
  listShares,
  listVersions,
  updateDocument,
} from "@/lib/documents/store";
import { log } from "@/lib/log";
import { authorizeDocument, notFound, requireEnabledIdentity } from "../authorize";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().min(1).refine((value) => value.trim() !== "", "body is empty").optional(),
});

const forbiddenEdit = () => fail("needs_role", { detail: "edit" });
const forbiddenManage = () => fail("needs_role", { detail: "owner" });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDocument(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();

  try {
    const db = getDb();
    const document = getDocument(db, id);
    if (!document) return notFound();
    const versions = listVersions(db, id);
    return Response.json({
      document,
      access: authz.access,
      body: versions.at(-1)?.body ?? "",
      versions,
      shares: listShares(db, id),
      comments: listComments(db, id),
      links: listLinks(db, id),
      publication: getPublication(db, id),
      disposition: dispositionFor(db, id),
    });
  } catch (error) {
    log.error("documents request failed", { route: "GET /api/documents/[id]", status: 500, err: String(error) });
    return fail("internal");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;

  let parsed: z.infer<typeof PatchBody>;
  try {
    parsed = PatchBody.parse(await request.json());
  } catch (error) {
    log.info("documents request rejected", { route: "PATCH /api/documents/[id]", err: String(error) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canEdit(access)) return forbiddenEdit();
    // The format carries forward. An edit that dropped it would relabel a
    // designed page as markdown, and the markdown renderer discards raw HTML
    // rather than printing it, so the next read would be an empty document.
    if (parsed.body !== undefined) {
      addVersion(db, id, gate.identity.email, parsed.body, { format: listVersions(db, id).at(-1)?.format });
    }
    if (parsed.title !== undefined) updateDocument(db, id, { title: parsed.title });
    const document = getDocument(db, id);
    const versions = listVersions(db, id);
    return Response.json({ document, access, body: versions.at(-1)?.body ?? "", disposition: dispositionFor(db, id) });
  } catch (error) {
    log.error("documents request failed", { route: "PATCH /api/documents/[id]", status: 500, err: String(error) });
    return fail("internal");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDocument(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canManage(authz.access)) return forbiddenManage();

  try {
    deleteDocument(getDb(), id);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("documents request failed", { route: "DELETE /api/documents/[id]", status: 500, err: String(error) });
    return fail("internal");
  }
}
