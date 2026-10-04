import { requireIdentity } from "@/lib/auth/identity";
import { isConnectorsEnabled, isConnectorOauthEnabled } from "@/lib/connectors/config";
import { loadConnectorRegistry } from "@/lib/connectors/registry";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { listCredentialSlugs } from "@/lib/db/connector-credentials";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("connectors request rejected", { route: "GET /api/connectors", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  if (!isConnectorsEnabled()) return fail("not_found");

  try {
    const clearance = new Set(resolveClearanceForEmail(identity.email));
    const oauthEnabled = isConnectorOauthEnabled();
    const connectedSlugs = oauthEnabled ? new Set(listCredentialSlugs(getDb(), identity.email)) : null;
    const connectors = loadConnectorRegistry()
      .entries.filter((entry) => entry.groups.some((group) => clearance.has(group)))
      .map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        transport: entry.transport,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.icon ? { icon: entry.icon } : {}),
        ...(entry.auth === "oauth" ? { auth: entry.auth } : {}),
        ...(entry.auth === "oauth" && connectedSlugs ? { connected: connectedSlugs.has(entry.slug) } : {}),
      }));
    return Response.json({ connectors });
  } catch (e) {
    log.error("connectors request failed", {
      route: "GET /api/connectors",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
