import { getDb } from "@/lib/db/client";
import { getProjectDocument } from "@/lib/db/project-docs";
import { readProjectDocument } from "@/lib/projects/doc-store";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { authorizeProject, NOT_FOUND } from "../authorize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/documents/[docId] -> the document's bytes
 * (surface-polish P-04). Before this, an uploaded project document rendered as
 * plain text with no way to open it.
 *
 * Clearance-scoped through the project, and every denial is the SAME 404: an
 * uncleared requester, a document filed under another project, and a document
 * that never existed are indistinguishable, so the route cannot be used to
 * probe for a file's existence.
 */

/** Types a browser can render in place rather than dropping in Downloads. */
const INLINE_TYPES = new Set(["text/plain", "text/markdown", "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * A `Content-Disposition` value that survives a filename with a quote, a
 * newline, or a non-ASCII character. The plain `filename` is stripped to a safe
 * ASCII subset for old clients; `filename*` carries the real name.
 */
function disposition(filename: string, contentType: string): string {
  const kind = INLINE_TYPES.has(contentType) ? "inline" : "attachment";
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
): Promise<Response> {
  const { id, docId } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;

  try {
    const doc = getProjectDocument(getDb(), id, docId);
    if (!doc) return NOT_FOUND();
    const bytes = readProjectDocument({ projectId: id, id: doc.id, filename: doc.filename });
    // A row whose bytes are gone reads as missing rather than as a server
    // fault: from the caller's side there is nothing to download either way.
    if (!bytes) return NOT_FOUND();
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.contentType,
        "content-length": String(bytes.length),
        "content-disposition": disposition(doc.filename, doc.contentType),
        // Project documents are clearance-scoped, so no shared cache may hold
        // a copy that a later, uncleared requester could be served.
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    log.error("project document download failed", {
      route: "GET /api/projects/[id]/documents/[docId]",
      error: String(error),
    });
    return fail("internal");
  }
}
