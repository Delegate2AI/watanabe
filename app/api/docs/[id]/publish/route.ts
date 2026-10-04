import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { publishSharedDoc } from "@/lib/shared-docs/publish";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  mode: z.enum(["mr", "direct"]).default("mr"),
  targetPath: z.string().trim().min(1).max(1024),
  targetVisibility: z.array(z.string().trim().min(1)).min(1),
});

/**
 * POST /api/docs/[id]/publish -> promote a shared doc to the knowledge base
 * through the spec-03 write path (spec 2026-08-11).
 *
 * Authorization lives in `publishSharedDoc`, not here, so the ACL is resolved in
 * one place and this route only translates its status onto the closed code set.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  const { id } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const result = await publishSharedDoc(getDb(), {
      id,
      actorEmail: identity.email,
      actorName: identity.name,
      mode: body.mode,
      targetPath: body.targetPath,
      targetVisibility: body.targetVisibility,
    });
    if (!result.ok) {
      // The publisher's own sentence stays in the log. A 404 covers both "no
      // such document" and "not yours", which is what keeps the two
      // indistinguishable from outside.
      if (result.status === 403) return fail("needs_role");
      if (result.status === 404) return fail("not_found");
      if (result.status === 503) return fail("write_unavailable");
      if (result.status === 409) return fail("conflict");
      if (result.status === 400) return fail("invalid_request", { detail: "targetPath" });
      return fail("internal");
    }
    return Response.json(result);
  } catch (error) {
    log.error("shared-docs request failed", {
      route: "POST /api/docs/[id]/publish",
      status: 500,
      err: String(error),
    });
    return fail("internal");
  }
}
