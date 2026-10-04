import { readFileSync } from "node:fs";
import { resolveIdentity } from "@/lib/identity/resolve";
import { vaultRootFor } from "@/lib/repo";
import { resolveVaultEntry } from "@/lib/vault";
import { contentTypeForAsset } from "@/lib/kb/content-type";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves a KB binary asset (image, PDF, ...) as its real bytes, by its
 * vault-relative path. A note embeds a diagram via the markdown renderer's
 * `img` rewrite (which points image srcs here), and the `/kb/[[...slug]]` page
 * redirects a direct non-`.md` URL here too, so both an embedded image and a
 * pasted asset URL render the picture instead of feeding the bytes through the
 * markdown viewer as garbled text.
 *
 * Clearance is enforced exactly as the rest of the `/kb` view enforces it: the
 * read goes through `resolveVaultEntry` against `vaultRootFor(clearance)` (spec
 * 19), so an asset the requester is not cleared for is physically absent from
 * that root and 404s, byte-identical to "does not exist". Absence is the
 * boundary; the same `isPathWithinVault` containment the chat agent's tool gate
 * uses keeps a crafted `..` path from ever escaping the vault. A markdown file
 * is never served here (it is a document, rendered as HTML by the page). Only
 * non-`.md` files are assets.
 */
function readAsBody(absPath: string): Uint8Array<ArrayBuffer> | null {
  try {
    // Copy into a fresh ArrayBuffer-backed view: a Node Buffer is not a valid
    // web `BodyInit`, but a Uint8Array is.
    const raw = readFileSync(absPath);
    const out = new Uint8Array(raw.byteLength);
    out.set(raw);
    return out;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const identity = await resolveIdentity(request.headers);
  // Fail closed, byte-identical to "does not exist" (mirrors requesterVaultRoot).
  if (!identity) return new Response(null, { status: 404 });

  const { path } = await params;
  const entry = resolveVaultEntry(path ?? [], vaultRootFor(identity.clearance));

  // Absent from the projection, a directory, or a markdown document: all 404,
  // indistinguishable from missing.
  if (!entry || entry.isDirectory || entry.relPath.toLowerCase().endsWith(".md")) {
    return new Response(null, { status: 404 });
  }

  const bytes = readAsBody(entry.absPath);
  if (!bytes) return new Response(null, { status: 404 });

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentTypeForAsset(entry.relPath),
      // Clearance-scoped content: only the requester's own browser may cache it,
      // never a shared/proxy cache.
      "Cache-Control": "private, max-age=3600",
      // Never let a served asset be sniffed into a script type.
      "X-Content-Type-Options": "nosniff",
      // Neutralize scripts in a directly-navigated SVG. `sandbox` restricts
      // capabilities (scripts, forms), not resource loading, so it cannot break
      // a raster image, and has no effect on `<img>`/`<object>` embedding
      // (response CSP applies only to top-level document navigation).
      "Content-Security-Policy": "sandbox",
    },
  });
}
