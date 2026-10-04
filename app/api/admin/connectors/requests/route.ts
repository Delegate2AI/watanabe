import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { getDb } from "@/lib/db/client";
import { countOpenConnectorRequests, listOpenConnectorRequests, resolveConnectorRequest } from "@/lib/db/connector-requests";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RESOLVE_BODY_BYTES = 2_000;

const resolveSchema = z.object({ id: z.string().min(1) });

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  try {
    const db = getDb();
    return Response.json({ requests: listOpenConnectorRequests(db), openCount: countOpenConnectorRequests(db) });
  } catch (e) {
    log.error("connectors request failed", {
      route: "GET /api/admin/connectors/requests",
      status: 500,
      owner: auth.identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  const read = await readCappedBody(request, MAX_RESOLVE_BODY_BYTES);
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
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "id" });

  try {
    const resolved = resolveConnectorRequest(getDb(), parsed.data.id, auth.identity.email);
    if (!resolved) return fail("invalid_request", { detail: "id" });
    return Response.json({ resolved: true });
  } catch (e) {
    log.error("connectors request failed", {
      route: "PATCH /api/admin/connectors/requests",
      status: 500,
      owner: auth.identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
