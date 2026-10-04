import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { publishDocument } from "@/lib/documents/publish";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ mode: z.enum(["mr", "direct"]).default("mr") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  const { id } = await params;

  let mode: "mr" | "direct";
  try {
    mode = Body.parse(await request.json().catch(() => ({}))).mode;
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const result = await publishDocument(getDb(), {
      id,
      ownerEmail: identity.email,
      ownerName: identity.name,
      mode,
    });
    if (!result.ok) {
      // The publisher's own sentence never travels: its status is the only
      // thing read, and it maps onto the closed code set. A 403 and a 404 stay
      // exactly where they were, so the no-oracle split is unchanged.
      if (result.status === 403) return fail("needs_role");
      if (result.status === 404) return fail("not_found");
      if (result.status === 503) return fail("write_unavailable");
      if (result.status === 409) return fail("wrong_status");
      if (result.status === 400) return fail("invalid_request");
      return fail("internal");
    }
    return Response.json(result);
  } catch (error) {
    log.error("documents request failed", { route: "POST /api/documents/[id]/publish", status: 500, err: String(error) });
    return fail("internal");
  }
}
