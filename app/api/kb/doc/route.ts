import { unauthorized } from "@/lib/auth/identity";
import { fail } from "@/lib/errors/codes";
import { resolveIdentity } from "@/lib/identity/resolve";
import { vaultRootFor } from "@/lib/repo";
import { resolveKbDoc } from "@/lib/kb/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fetch a single KB document's markdown by vault-relative path, for the chat
 * source-card preview overlay (spec 24 source cards). Reads ONLY through
 * `vaultRootFor(clearance)`, the exact same clearance-scoped seam the `/kb`
 * page uses: a note the requester is not cleared for is absent from that root,
 * so it 404s here identically to "does not exist". Absence is the boundary;
 * there is no per-file clearance check, and the 404 body never distinguishes
 * restricted from missing.
 *
 * Returns the raw markdown `body` (rendered client-side by the shared Markdown
 * component) plus the frontmatter-derived title/visibility, never a filesystem
 * path or the doc's on-disk location.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await resolveIdentity(request.headers);
  // The one shared 401, the same body every other route answers an anonymous
  // request with. Authentication sits below the reason-code contract: there is
  // no identity yet to report a reason to.
  if (!identity) return unauthorized();

  const path = new URL(request.url).searchParams.get("path");
  if (!path) return fail("invalid_request", { detail: "path" });

  // Route slug segments, exactly as the `/kb/[[...slug]]` page would receive
  // them. resolveVaultEntry (under resolveKbDoc) handles both the `.md` form
  // and the clean-URL form, and contains every read to the scoped root.
  const slug = path.split("/").filter(Boolean);
  const root = vaultRootFor(identity.clearance);
  const resolution = resolveKbDoc(slug, root);

  // Restricted and missing are the same answer, deliberately.
  if (!resolution || resolution.kind !== "doc") return fail("not_found");

  const { note, relPath } = resolution;
  return Response.json({
    path: relPath,
    title: note.title,
    visibility: note.visibility,
    group: note.group,
    body: note.body,
  });
}
