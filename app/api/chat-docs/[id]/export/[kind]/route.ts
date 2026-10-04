import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { getDocForOwner, getVersions, latestVersion } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { isCanvasEnabled } from "@/lib/canvas/config";
import type { DocFormat } from "@/lib/documents/types";
import { fail } from "@/lib/errors/codes";
import { renderDocumentExports } from "@/lib/render/pipeline";
import { readRender, type RenderKind } from "@/lib/render/store";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/chat-docs/[id]/export/[kind] -> one document as `.md`, `.html` or
 * `.pdf` (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Owner-scoped exactly like the sibling read route: a foreign id, an unknown id
 * and the flag being off all answer with the same 404, so this is not an
 * existence oracle for other people's documents.
 *
 * Renders on demand when the file is not in the store. A render is normally
 * armed on save (`lib/render/schedule.ts`), but the debounce may not have fired,
 * a pod may have restarted mid-timer, or the version may predate the feature. A
 * download is exactly the moment it is worth paying for, and the pipeline is
 * idempotent, so asking again is free.
 */

const NOT_FOUND = () => fail("not_found");

const KINDS: Record<RenderKind, { type: string; extension: string }> = {
  md: { type: "text/markdown; charset=utf-8", extension: "md" },
  html: { type: "text/html; charset=utf-8", extension: "html" },
  pdf: { type: "application/pdf", extension: "pdf" },
};

function isRenderKind(value: string): value is RenderKind {
  return value === "md" || value === "html" || value === "pdf";
}

/** One specific version, owner-scoped, or null when there is no such version. */
function versionAt(
  db: ReturnType<typeof getDb>,
  id: string,
  owner: string,
  version: number,
): { version: number; body: string; format: DocFormat } | null {
  return getVersions(db, id, owner).find((v) => v.version === version) ?? null;
}

/** A `Content-Disposition` value that survives a title with a quote or a comma. */
function disposition(title: string, extension: string): string {
  const name = `${title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}.${extension}`;
  return `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isCanvasEnabled()) return NOT_FOUND();

  const { id, kind } = await params;
  if (!isRenderKind(kind)) return fail("invalid_request", { detail: "kind" });
  const owner = auth.identity.email;

  try {
    const doc = getDocForOwner(getDb(), id, owner);
    // Source-thread ownership is the authority, and defense in depth: the store
    // already scopes by it. Foreign, unknown and flag-off are one 404.
    if (!doc || !isOwnedBy(getDb(), doc.threadId, owner)) return NOT_FOUND();
    // `?v=` selects a version, defaulting to the latest. The canvas sends the
    // version it is actually showing: without it, reading an older version and
    // pressing Download silently handed over the newest one instead.
    const requested = Number(new URL(request.url).searchParams.get("v"));
    const latest = latestVersion(getDb(), id, owner);
    if (!latest) return NOT_FOUND();
    const wanted =
      Number.isSafeInteger(requested) && requested > 0 ? versionAt(getDb(), id, owner, requested) : latest;
    // An unknown version number is a missing thing, not a bad request: the same
    // 404 as an unknown document, so this cannot count a document's versions.
    if (!wanted) return NOT_FOUND();

    const ref = { ownerEmail: owner, docId: id, version: wanted.version, kind };
    let bytes = readRender(ref);
    if (!bytes) {
      await renderDocumentExports({
        ownerEmail: owner,
        docId: id,
        version: wanted.version,
        title: doc.title,
        body: wanted.body,
        format: wanted.format,
      });
      bytes = readRender(ref);
    }
    // Only reachable for `pdf` and `html`, which need the sidecar. Markdown is
    // derived in process, so it is always available. 503 rather than 404: the
    // document exists and this is a deployment condition, not a missing thing.
    if (!bytes) return fail("write_unavailable", { status: 503 });

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": KINDS[kind].type,
        "content-disposition": disposition(doc.title, KINDS[kind].extension),
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    log.error("chat-doc export failed", {
      route: "GET /api/chat-docs/[id]/export/[kind]",
      status: 500,
      err: String(e),
    });
    return fail("internal");
  }
}
