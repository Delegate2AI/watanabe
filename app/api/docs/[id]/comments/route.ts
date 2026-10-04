import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { addComment, listComments } from "@/lib/db/shared-docs";
import { createThread, listThreads } from "@/lib/db/comment-threads";
import { accessFor, canRead, canComment } from "@/lib/shared-docs/access";
import { authorizeDoc, requireEnabledIdentity, notFound } from "@/lib/shared-docs/authorize";
import { isDocAnnotationsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Comments (spec 28), for comment/edit access. "none" -> 404 (no oracle); a
 * view-only recipient can read the doc but not its comments (comment access is
 * "read the doc + add/see comments"), so they get a 403 here, never the thread.
 *
 * Flag-on (DOC_ANNOTATIONS_ENABLED, spec 2026-07-22): GET returns threads and
 * POST creates an anchored thread. Flag-off keeps the legacy flat comment list
 * byte-identical, so an existing deployment sees no change until it opts in.
 */

const forbidden = () => fail("needs_role", { detail: "comment" });

const anchorSchema = z.object({
  quote: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  start: z.number().int().nonnegative(),
});
const LegacyBody = z.object({ body: z.string().min(1), anchor: z.string().trim().min(1).max(200).optional() });
const ThreadBody = z.object({ body: z.string().min(1), anchor: anchorSchema.optional() });

/** GET -> the comment thread (comment/edit access): threads when the flag is on, else the legacy flat list. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeDoc(request, getDb(), id);
  if ("response" in authz) return authz.response;
  if (!canRead(authz.access)) return notFound();
  if (!canComment(authz.access)) return forbidden();
  try {
    if (isDocAnnotationsEnabled()) return Response.json({ threads: listThreads(getDb(), id) });
    return Response.json({ comments: listComments(getDb(), id) });
  } catch (e) {
    log.error("shared-docs request failed", { route: "GET /api/docs/[id]/comments", status: 500, err: String(e) });
    return fail("internal");
  }
}

/**
 * POST -> add a comment (comment/edit access), authored under the caller.
 * TOCTOU-safe (finding 3): identity + flag first, THEN parse the body (async),
 * THEN re-resolve the ACL synchronously and write with no await between the
 * check and the insert, so comment access revoked in-flight is honored.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;

  const annotations = isDocAnnotationsEnabled();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = annotations ? ThreadBody.safeParse(json) : LegacyBody.safeParse(json);
  if (!parsed.success) {
    return fail("invalid_request", { detail: "body" });
  }
  if (parsed.data.body.trim() === "") return fail("invalid_request", { detail: "body" });

  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canComment(access)) return forbidden();
    if (annotations) {
      const anchor = (parsed.data as z.infer<typeof ThreadBody>).anchor ?? null;
      createThread(db, {
        id: randomUUID(), docId: id, anchor, createdBy: gate.identity.email,
        createdAt: new Date().toISOString(), body: parsed.data.body, messageId: randomUUID(),
      });
    } else {
      const legacy = parsed.data as z.infer<typeof LegacyBody>;
      addComment(db, { id: randomUUID(), docId: id, authorEmail: gate.identity.email, body: legacy.body, anchor: legacy.anchor ?? null });
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", { route: "POST /api/docs/[id]/comments", status: 500, err: String(e) });
    return fail("internal");
  }
}
