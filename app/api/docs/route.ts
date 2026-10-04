import { randomUUID } from "node:crypto";
import { z } from "zod";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { insertSharedDoc, listSharedByOwner, listSharedWith } from "@/lib/db/shared-docs";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { getArtifactForOwner, latestBody as latestArtifactBody } from "@/lib/db/artifacts";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import { MAX_TITLE, deriveTitle } from "@/lib/shared-docs/title";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// MAX_TITLE and deriveTitle live in `lib/shared-docs/title.ts` because the
// import route creates documents too and has to bound titles the same way.

// Either supply a `body` directly, or seed from an artifact the caller owns
// (spec 27 -> spec 28: "Share" on an artifact creates a shared doc from its
// current version). Publishing to the KB and sharing to people stay independent.
const CreateBody = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE).optional(),
  body: z.string().min(1).optional(),
  fromArtifactId: z.string().min(1).optional(),
});

/**
 * POST /api/docs -> create a shared doc owned by the caller, seeded with v1
 * (spec 28). Flag-gated by `SHARED_DOCS_ENABLED`; off, this is a 404 empty
 * surface so no doc can be created and the flag-off byte-path is unchanged.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;

  if (!isSharedDocsEnabled()) {
    return fail("not_found");
  }

  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await request.json());
  } catch (e) {
    log.info("shared-docs request rejected", { route: "POST /api/docs", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }

  // Resolve the seed body + title: either a direct body, or the current version
  // of an artifact the caller OWNS. A foreign or unknown artifact both fail the
  // owner-scoped read and return the SAME 404 (no existence oracle). This seeds a
  // NEW, independent shared doc: it does not publish the artifact to the KB.
  let seedBody: string;
  let seedTitleFallback: string | undefined = parsed.title;
  if (parsed.fromArtifactId) {
    const artifact = getArtifactForOwner(getDb(), parsed.fromArtifactId, identity.email);
    const artifactBody = artifact ? latestArtifactBody(getDb(), parsed.fromArtifactId, identity.email) : null;
    if (!artifact || artifactBody === null) {
      return fail("not_found");
    }
    seedBody = artifactBody;
    seedTitleFallback = parsed.title ?? artifact.title;
  } else if (parsed.body !== undefined && parsed.body.trim() !== "") {
    seedBody = parsed.body;
  } else {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const id = randomUUID();
    insertSharedDoc(getDb(), {
      id,
      title: deriveTitle(seedTitleFallback, seedBody),
      ownerEmail: identity.email,
      body: seedBody,
    });
    captureServerEvent("doc_created", {
      distinctId: analyticsIdFor(identity.email),
      properties: { fromArtifact: Boolean(parsed.fromArtifactId), bodyLength: seedBody.length },
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", {
      route: "POST /api/docs",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

/**
 * GET /api/docs -> the caller's two groups: docs they own ("shared by me") and
 * docs shared WITH them (carrying their granted access). Identity-scoped through
 * the store, so no group can surface another user's private docs.
 *
 * Flag-off is a 404 (finding 4): this route did not exist before this feature,
 * so returning a 200 payload when SHARED_DOCS_ENABLED is off would not be
 * flag-off byte-identical. It now returns the same feature-off 404 as every
 * other shared-doc route, BEFORE any list work.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;

  if (!isSharedDocsEnabled()) {
    return fail("not_found");
  }

  try {
    const sharedByMe = listSharedByOwner(getDb(), identity.email).map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
    }));
    const sharedWithMe = listSharedWith(getDb(), identity.email, shareClearanceFor(identity.email)).map((d) => ({
      id: d.id,
      title: d.title,
      ownerEmail: d.ownerEmail,
      access: d.access,
      updatedAt: d.updatedAt,
    }));
    return Response.json({ sharedByMe, sharedWithMe });
  } catch (e) {
    log.error("shared-docs request failed", {
      route: "GET /api/docs",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
