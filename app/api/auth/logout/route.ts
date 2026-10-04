import { getConfig } from "@/lib/config";
import { log } from "@/lib/log";
import { sessionClearCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/logout: clear the session cookie and return to /login.
 *
 * POST rather than GET so a cross-site image tag cannot sign someone out. A
 * POST alone does not stop a cross-site FORM submission, which browsers still
 * allow cross-origin, so this also requires `Origin` to equal this portal's
 * own configured origin. A request with no `Origin` header at all is refused
 * rather than let through: every real browser attaches `Origin` to a POST,
 * same-origin or not, so its absence means this did not come from a browser
 * following the account menu's own form.
 *
 * The session is stateless, so this is the whole of it: there is nothing on
 * the server to revoke. Idempotent, and safe to call with no session at all.
 */
export async function POST(request: Request): Promise<Response> {
  const { auth } = getConfig();
  if (auth.mode !== "oidc") return new Response("Not Found", { status: 404 });

  const configuredOrigin = new URL(auth.oidc.baseUrl).origin;
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin !== configuredOrigin) {
    log.warn("oidc logout rejected", { reason: "origin_mismatch" });
    return new Response("Forbidden", { status: 403 });
  }

  const headers = new Headers({ location: `${configuredOrigin}/login` });
  headers.append("set-cookie", sessionClearCookie(auth.oidc));
  return new Response(null, { status: 303, headers });
}
