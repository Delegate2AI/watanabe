import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { publishArtifact } from "@/lib/artifacts/publish";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ mode: z.enum(["mr", "direct"]).default("mr") });

/**
 * POST /api/artifacts/[id]/publish -> publish the artifact to the KB through
 * the existing write path (spec 27). All the doctrine (write-path only,
 * role-gated, owner-scoped, no oracle, flag-gated) lives in `publishArtifact`;
 * this route only resolves identity, validates the mode, and maps the typed
 * result to a Response status. A `{ ok: false, status }` is surfaced verbatim
 * so a foreign/unknown id (404), a denied role (403), and a not-ready artifact
 * (409) each carry their own code.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  const { id } = await params;

  let mode: "mr" | "direct";
  try {
    mode = Body.parse(await request.json().catch(() => ({}))).mode;
  } catch (e) {
    // The zod issue is logged, never returned: `message` is for a literal the
    // route chose, not for a sentence a library wrote about the caller's input.
    log.warn("artifacts request rejected", { route: "POST /api/artifacts/[id]/publish", err: String(e) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const result = await publishArtifact(getDb(), {
      id,
      ownerEmail: identity.email,
      ownerName: identity.name,
      mode,
    });
    if (!result.ok) {
      if (result.status === 403) return fail("needs_role");
      if (result.status === 404) return fail("not_found");
      if (result.status === 503) return fail("write_unavailable");
      if (result.status === 409) return fail("wrong_status");
      if (result.status === 400) return fail("invalid_request");
      return fail("internal");
    }
    return Response.json(result);
  } catch (e) {
    log.error("artifacts request failed", { route: "POST /api/artifacts/[id]/publish", status: 500, err: String(e) });
    return fail("internal");
  }
}
