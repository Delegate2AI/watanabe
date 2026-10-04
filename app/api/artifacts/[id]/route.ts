import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import {
  getArtifactForOwner,
  getVersions,
  latestBody,
  addVersion, latestVersionOf,
  updateArtifact,
  deleteArtifact,
} from "@/lib/db/artifacts";
import { isArtifactsEnabled } from "@/lib/artifacts/config";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = () => fail("not_found");

/**
 * GET /api/artifacts/[id] -> the artifact, its current body, and its version
 * history, for the owner only.
 *
 * Owner-scoped: `getArtifactForOwner` returns null for a foreign OR unknown id,
 * both mapping to the SAME 404 so there is no existence oracle. Flag-off is a
 * 404 too, keeping the surface dark.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isArtifactsEnabled()) return NOT_FOUND();
  const { id } = await params;

  try {
    const artifact = getArtifactForOwner(getDb(), id, auth.identity.email);
    if (!artifact) return NOT_FOUND();
    return Response.json({
      artifact,
      body: latestBody(getDb(), id, auth.identity.email) ?? "",
      versions: getVersions(getDb(), id, auth.identity.email),
    });
  } catch (e) {
    log.error("artifacts request failed", { route: "GET /api/artifacts/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}

// `published` is intentionally NOT a settable status here: an artifact only
// becomes published by actually going through the write path (the publish
// route). Allowing it via PATCH would let the DB claim a note was published
// that was never submitted.
const PatchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().min(1).optional(),
  targetPath: z.string().trim().min(1).optional(),
  targetVisibility: z.array(z.string().min(1)).min(1).optional(),
  status: z.enum(["draft", "ready"]).optional(),
});

/**
 * PATCH /api/artifacts/[id] -> edit the body (appends a version), rename, set
 * the publish target (`targetPath`/`targetVisibility`), and/or transition
 * draft <-> ready. Owner-scoped: every store call filters by the caller's
 * email, so a foreign id updates zero rows and returns the same 404 as an
 * unknown id (no existence oracle). Moving to `ready` requires a target path
 * (from this patch or already set), since a ready artifact must know where it
 * will land.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isArtifactsEnabled()) return NOT_FOUND();
  const { id } = await params;
  const owner = auth.identity.email;

  let parsed: z.infer<typeof PatchBody>;
  try {
    parsed = PatchBody.parse(await request.json());
  } catch {
    return fail("invalid_request");
  }

  try {
    const existing = getArtifactForOwner(getDb(), id, owner);
    if (!existing) return NOT_FOUND();

    // Content that has already been submitted is frozen at the server, not just
    // in the editor. The client lock alone was defeatable by a second tab still
    // holding the artifact as `ready`: its Save could PATCH a new body after the
    // merge request opened, silently diverging the stored artifact from what
    // reviewers are reading, or PATCH the status back to `ready` and open a
    // second merge request for the same artifact.
    if (existing.status === "in_review" || existing.status === "published") {
      return fail("wrong_status");
    }

    if (parsed.status === "ready") {
      const willHaveTarget = parsed.targetPath ?? existing.targetPath;
      if (!willHaveTarget) {
        return fail("invalid_request");
      }
    }

    // The format carries forward. An edit that dropped it would relabel a
    // designed page as markdown, and the markdown renderer discards raw HTML
    // rather than printing it, so the next read would be an empty document.
    if (parsed.body !== undefined) {
      addVersion(getDb(), id, owner, parsed.body, { format: latestVersionOf(getDb(), id, owner)?.format });
    }
    updateArtifact(getDb(), id, owner, {
      title: parsed.title,
      targetPath: parsed.targetPath,
      targetVisibility: parsed.targetVisibility,
      status: parsed.status,
    });

    const artifact = getArtifactForOwner(getDb(), id, owner);
    return Response.json({ artifact, body: latestBody(getDb(), id, owner) ?? "" });
  } catch (e) {
    log.error("artifacts request failed", { route: "PATCH /api/artifacts/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}

/**
 * DELETE /api/artifacts/[id] -> delete an UNPUBLISHED artifact and its versions,
 * for the owner only. Owner-scoped like the rest of this route: a foreign or
 * unknown id returns the same 404 (no existence oracle).
 *
 * A `published` artifact is refused with 409: it has a real note in the KB
 * (landed via the write path), and deleting the artifact record here would not
 * unpublish that note, so the delete would be a misleading half-action. A draft
 * or ready artifact has no committed note and is safe to remove.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isArtifactsEnabled()) return NOT_FOUND();
  const { id } = await params;
  const owner = auth.identity.email;

  try {
    const existing = getArtifactForOwner(getDb(), id, owner);
    if (!existing) return NOT_FOUND();
    // `in_review` is undeletable for the same reason `published` is, and then
    // some: deleting the row here would leave the merge request and its branch
    // open on GitLab, so a proposal the owner believed they had abandoned could
    // still be merged and published with no artifact left to explain it. The
    // merge request is the proposal; it is closed in review, not here.
    if (existing.status === "published" || existing.status === "in_review") {
      return fail("wrong_status");
    }
    deleteArtifact(getDb(), id, owner);
    return Response.json({ ok: true });
  } catch (e) {
    log.error("artifacts request failed", { route: "DELETE /api/artifacts/[id]", status: 500, err: String(e) });
    return fail("internal");
  }
}
