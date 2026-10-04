import { randomUUID } from "node:crypto";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { insertSharedDoc } from "@/lib/db/shared-docs";
import { isDocImportEnabled } from "@/lib/shared-docs/config";
import {
  importedDocFromFile,
  maxImportBytes,
  maxRequestBytes,
  type ImportFailure,
} from "@/lib/shared-docs/import-doc";
import { boundedFormData } from "@/lib/http/bounded-form";
import { STATUS, fail } from "@/lib/errors/codes";
import type { ErrorCode } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One closed set of refusals, one code each. */
const CODE_FOR: Record<ImportFailure, ErrorCode> = {
  unsupported: "unsupported_file",
  too_large: "file_too_large",
  unreadable: "unreadable_file",
};

/**
 * POST /api/docs/import (multipart) -> a shared doc owned by the caller, seeded
 * from an uploaded `.md` or `.docx`. Same `insertSharedDoc` as the create route,
 * so an imported doc is versioned and private to its owner like any other.
 *
 * The owner is the authenticated email, never a form field. Gated by
 * `DOC_IMPORT_ENABLED`, which 404s before the body is read.
 */
export async function POST(request: Request): Promise<Response> {
  // Before the identity check, so a disabled route answers 404 to everyone
  // rather than 401 to a caller without a session, which would tell them the
  // route exists. Same order as the other flag-gated document routes.
  if (!isDocImportEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxRequestBytes()) {
    log.warn("doc import rejected", {
      route: "POST /api/docs/import",
      status: 413,
      reason: "declared_size",
      owner: identity.email,
      declared,
    });
    return fail("file_too_large");
  }

  let form: FormData;
  try {
    form = await boundedFormData(request, maxRequestBytes());
  } catch (e) {
    // A chunked upload declares no length, so counting the bytes as they arrive
    // is the only bound on it. Either way nothing past the cap is buffered.
    if (e instanceof RangeError) {
      log.warn("doc import rejected", {
        route: "POST /api/docs/import",
        status: 413,
        reason: "body_size",
        owner: identity.email,
      });
      return fail("file_too_large");
    }
    return fail("invalid_request", { detail: "body" });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("invalid_request", { detail: "file" });

  // On the declared size, before the bytes are buffered into memory.
  if (file.size > maxImportBytes()) {
    log.warn("doc import rejected", {
      route: "POST /api/docs/import",
      status: 413,
      reason: "too_large",
      owner: identity.email,
      size: file.size,
    });
    return fail("file_too_large");
  }

  let result;
  try {
    result = await importedDocFromFile({
      filename: file.name || "document",
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    log.error("doc import failed", {
      route: "POST /api/docs/import",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }

  if (!result.ok) {
    log.warn("doc import rejected", {
      route: "POST /api/docs/import",
      status: STATUS[CODE_FOR[result.reason]],
      reason: result.reason,
      owner: identity.email,
      filename: file.name,
    });
    return fail(CODE_FOR[result.reason]);
  }

  try {
    const id = randomUUID();
    insertSharedDoc(getDb(), {
      id,
      title: result.doc.title,
      ownerEmail: identity.email,
      body: result.doc.body,
    });
    log.info("doc imported", {
      route: "POST /api/docs/import",
      owner: identity.email,
      id,
      size: file.size,
      droppedImages: result.doc.droppedImages,
    });
    return Response.json(
      { id, title: result.doc.title, droppedImages: result.doc.droppedImages },
      { status: 201 },
    );
  } catch (e) {
    log.error("doc import failed", {
      route: "POST /api/docs/import",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
