import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { createConnectorRequest } from "@/lib/db/connector-requests";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CONNECTOR_REQUEST_BODY_BYTES = 8_000;

const bodySchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");

  const read = await readCappedBody(request, MAX_CONNECTOR_REQUEST_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === "unreadable") return fail("invalid_request", { detail: "body" });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "text" });

  try {
    const id = createConnectorRequest(getDb(), { requesterEmail: auth.identity.email, text: parsed.data.text });
    return Response.json({ id });
  } catch (e) {
    log.error("connectors request failed", {
      route: "POST /api/connectors/requests",
      status: 500,
      owner: auth.identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
