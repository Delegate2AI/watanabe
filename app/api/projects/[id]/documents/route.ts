import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  insertProjectDocument,
  listProjectDocuments,
  getProjectDocument,
  deleteProjectDocument,
} from "@/lib/db/project-docs";
import {
  validateProjectDocument,
  writeProjectDocument,
  deleteProjectDocumentFile,
} from "@/lib/projects/doc-store";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { authorizeProject, NOT_FOUND } from "./authorize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Project documents (spec 26 extension). Files uploaded into a project, scoped
 * by the PROJECT's visibility: a caller who can see the project can list, add,
 * and remove its documents. Bytes land outside the KB vault. Gated by
 * `PROJECTS_ENABLED`; flag-off every method 404s. Authorization lives in
 * `./authorize.ts`, shared with the per-document download route.
 */

/** GET -> the project's documents (metadata only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;
  try {
    return Response.json({ documents: listProjectDocuments(getDb(), id) });
  } catch (error) {
    log.error("project docs request failed", { route: "GET /api/projects/[id]/documents", error: String(error) });
    return fail("internal");
  }
}

/** POST (multipart) -> upload one file into the project. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_request", { detail: "multipart" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail("invalid_request", { detail: "file" });
  }
  const contentType = file.type || "application/octet-stream";
  // `check.error` names the offending mime type and the byte cap. It stays out
  // of the response body (failure contract): the picker's `accept` list is what
  // tells a person which types are allowed, not a server sentence.
  const check = validateProjectDocument({ mimeType: contentType, size: file.size });
  if (!check.ok) return fail("invalid_request", { detail: "file" });

  try {
    const docId = randomUUID();
    const filename = file.name || "document";
    const bytes = Buffer.from(await file.arrayBuffer());
    writeProjectDocument({ projectId: id, id: docId, filename, bytes });
    const doc = {
      id: docId,
      projectId: id,
      filename,
      contentType,
      byteSize: bytes.length,
      uploaderEmail: authz.email,
      createdAt: new Date().toISOString(),
    };
    insertProjectDocument(getDb(), doc);
    log.info("project document stored", { route: "POST /api/projects/[id]/documents", projectId: id, size: doc.byteSize });
    return Response.json({ document: doc });
  } catch (error) {
    log.error("project docs request failed", { route: "POST /api/projects/[id]/documents", error: String(error) });
    return fail("internal");
  }
}

/** DELETE -> remove one document (metadata + bytes) from the project. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;

  let body: { documentId?: unknown };
  try {
    body = (await request.json()) as { documentId?: unknown };
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!documentId) return fail("invalid_request", { detail: "documentId" });

  try {
    const doc = getProjectDocument(getDb(), id, documentId);
    if (!doc) return NOT_FOUND();
    deleteProjectDocumentFile({ projectId: id, id: doc.id, filename: doc.filename });
    deleteProjectDocument(getDb(), id, documentId);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("project docs request failed", { route: "DELETE /api/projects/[id]/documents", error: String(error) });
    return fail("internal");
  }
}
