import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";
import { clientRegistrationProblem, registerClient } from "@/lib/mcp-auth/clients";
import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RFC 7591 dynamic client registration (spec 2026-09-05, D4).
 *
 * Unauthenticated by design, and reachable without a cookie, because the client
 * calling it is a piece of software that has never met this deployment. That is
 * safe because registering grants nothing: a client id buys the ability to ask,
 * and every authorization still requires a human to reach /oauth/authorize
 * through SSO and approve.
 *
 * **No client secret is ever issued.** Every client is public and PKCE is
 * mandatory. That is the whole point: there is no credential to distribute, put
 * on a page, or rotate.
 *
 * What it does create is rows written by anonymous callers, so it is rate
 * limited and every field is bounded. Errors follow RFC 7591's shape rather
 * than this app's failure contract: the caller is an OAuth client, not a
 * browser, and it is looking for `error` and `error_description`.
 */
const RegisterBody = z.object({
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
});

function invalid(description: string): Response {
  return Response.json(
    { error: "invalid_client_metadata", error_description: description },
    { status: 400, headers: { "access-control-allow-origin": "*" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpAuthServerReady()) return Response.json({ error: "not found" }, { status: 404 });

  if (!rateLimit("oauth-register", clientKey(request.headers), 10, 60_000)) {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Too many registrations. Try again shortly." },
      { status: 429, headers: { "access-control-allow-origin": "*" } },
    );
  }

  const parsed = RegisterBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid("client_name and redirect_uris are required");

  const candidate = { clientName: parsed.data.client_name, redirectUris: parsed.data.redirect_uris };
  const problem = clientRegistrationProblem(candidate);
  if (problem) return invalid(problem);

  try {
    const client = registerClient(getDb(), candidate);
    // The registration response names the client and nothing secret. Logged
    // without the name, which is attacker-supplied free text.
    log.info("oauth client registered", { clientId: client.clientId });
    return Response.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      { status: 201, headers: { "access-control-allow-origin": "*" } },
    );
  } catch (error) {
    // Validation already passed, so anything thrown here is a storage failure.
    // Its text is for the operator's log and never for an anonymous caller.
    log.error("oauth client registration failed", { error: String(error) });
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Registration could not be completed." },
      { status: 503, headers: { "access-control-allow-origin": "*" } },
    );
  }
}

/** Preflight, since a browser-based client may register cross-origin. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
