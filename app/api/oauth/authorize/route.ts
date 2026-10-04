import { requireIdentity } from "@/lib/auth/identity";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { checkAuthorizeParams, redirectWith } from "@/lib/mcp-auth/authorize";
import { issueCode } from "@/lib/mcp-auth/codes";
import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";
import { authorizationServerConfig } from "@/lib/mcp-auth/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The consent decision (spec 2026-09-05, D5).
 *
 * Behind SSO, unlike the register and token endpoints, because this is the one
 * step that needs to know which human is approving. It acts on that person's
 * decision, so it is a state change authenticated by a cookie, which means it
 * needs CSRF protection: without it, a page anywhere could auto-submit a form
 * and silently mint a code for whoever happened to be signed in.
 *
 * The defence is an Origin check against this deployment's own configured
 * origin. Browsers always send Origin on a cross-site POST, and a missing one
 * is refused rather than assumed same-site.
 */

function refuse(status: number, reason: string): Response {
  log.warn("oauth authorize rejected", { status, reason });
  return new Response(reason, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpAuthServerReady()) return new Response(null, { status: 404 });

  const config = authorizationServerConfig();
  const origin = request.headers.get("origin");
  // Absent is refused, not trusted: a same-origin form POST from a browser
  // carries Origin, and anything that does not is not the flow this serves.
  if (!config || origin !== config.issuer) {
    return refuse(403, "This request did not come from the workspace.");
  }

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  // The same membership rule the MCP endpoint applies. A verified identity on
  // no roster cannot approve access it would not itself be granted.
  if (!isKnownMember(auth.identity.email, loadGroups())) {
    return refuse(403, "This workspace does not recognize your account.");
  }

  const form = new URLSearchParams(await request.text().catch(() => ""));
  const checked = checkAuthorizeParams(getDb(), form);
  if (!checked.ok) {
    if (checked.kind === "display") return refuse(400, checked.reason);
    return Response.redirect(
      redirectWith(checked.redirectUri, { error: checked.error, state: checked.state }),
      303,
    );
  }

  const { request: authorized } = checked;
  if (form.get("decision") !== "approve") {
    return Response.redirect(
      redirectWith(authorized.redirectUri, { error: "access_denied", state: authorized.state }),
      303,
    );
  }

  const { code } = issueCode(getDb(), {
    clientId: authorized.clientId,
    ownerEmail: auth.identity.email,
    redirectUri: authorized.redirectUri,
    codeChallenge: authorized.codeChallenge,
  });
  log.info("oauth authorization granted", { clientId: authorized.clientId });
  return Response.redirect(redirectWith(authorized.redirectUri, { code, state: authorized.state }), 303);
}
