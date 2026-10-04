import { getDb } from "@/lib/db/client";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { getClient, touchClient } from "@/lib/mcp-auth/clients";
import { consumeCode, pruneExpiredCodes } from "@/lib/mcp-auth/codes";
import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";
import { issueRefreshToken, rotateRefreshToken } from "@/lib/mcp-auth/refresh";
import { mintToken } from "@/lib/mcp-auth/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The OAuth token endpoint (spec 2026-09-05).
 *
 * Unauthenticated in the client-credential sense, because no client secret is
 * ever issued. What stands in for client authentication is PKCE: only the
 * client that started the flow holds the verifier that matches the challenge
 * the code was bound to.
 *
 * Reachable without a cookie, so it must be carved out of the SSO gate.
 *
 * Errors follow RFC 6749, not this app's failure contract: the caller is an
 * OAuth client looking for `error` and `error_description`. Every failure of a
 * grant is `invalid_grant` with one sentence, deliberately uniform, so the
 * response cannot be used to tell an expired code from a spent one from a wrong
 * verifier.
 */

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;

const CORS = { "access-control-allow-origin": "*" };

function oauthError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status, headers: CORS });
}

/** One sentence for every way a grant can fail, so the difference is not readable. */
function invalidGrant(): Response {
  return oauthError("invalid_grant", "The grant is not valid, has expired, or has already been used.");
}

function issue(
  db: import("better-sqlite3").Database,
  grant: { clientId: string; clientName: string; ownerEmail: string },
  refreshToken: string,
  now: string,
): Response {
  const expiresAt = new Date(new Date(now).getTime() + ACCESS_TOKEN_TTL_MS).toISOString();
  const access = mintToken(
    db,
    {
      ownerEmail: grant.ownerEmail,
      // What the settings page shows beside the grant. Self-declared by the
      // client at registration, so it is rendered as text and never as markup.
      name: grant.clientName,
      clientId: grant.clientId,
      expiresAt,
    },
    now,
  );
  touchClient(db, grant.clientId, now);
  return Response.json(
    {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: "mcp",
    },
    // A token response must never be cached, by anything, anywhere.
    { headers: { ...CORS, "cache-control": "no-store", pragma: "no-cache" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpAuthServerReady()) return Response.json({ error: "not found" }, { status: 404 });

  if (!rateLimit("oauth-token", clientKey(request.headers), 60, 60_000)) {
    return oauthError("temporarily_unavailable", "Too many token requests. Try again shortly.", 429);
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError("invalid_request", "The request body could not be read.");
  }

  const grantType = form.get("grant_type") ?? "";
  const clientId = form.get("client_id")?.trim() ?? "";
  if (!clientId) return oauthError("invalid_request", "client_id is required.");

  const db = getDb();
  const client = getClient(db, clientId);
  // An unregistered client is refused as a client error, which is safe to
  // distinguish: the caller already knows whether it registered.
  if (!client) return oauthError("invalid_client", "No such client. Register first.", 401);

  const now = new Date().toISOString();

  if (grantType === "authorization_code") {
    const code = form.get("code")?.trim() ?? "";
    const verifier = form.get("code_verifier")?.trim() ?? "";
    const redirectUri = form.get("redirect_uri")?.trim() ?? "";
    if (!code || !verifier || !redirectUri) {
      return oauthError("invalid_request", "code, code_verifier and redirect_uri are required.");
    }

    const spent = consumeCode(db, code, { clientId, redirectUri, codeVerifier: verifier }, now);
    if (!spent) return invalidGrant();

    // Opportunistic, and only on the path that just proved somebody is using
    // the flow: the table is small and this keeps it that way with no job.
    pruneExpiredCodes(db, now);

    const refresh = issueRefreshToken(db, { clientId, ownerEmail: spent.ownerEmail }, now);
    return issue(db, { clientId, clientName: client.clientName, ownerEmail: spent.ownerEmail }, refresh.token, now);
  }

  if (grantType === "refresh_token") {
    const presented = form.get("refresh_token")?.trim() ?? "";
    if (!presented) return oauthError("invalid_request", "refresh_token is required.");

    const rotated = rotateRefreshToken(db, presented, clientId, now);
    if (!rotated) return invalidGrant();

    return issue(db, { clientId, clientName: client.clientName, ownerEmail: rotated.ownerEmail }, rotated.token, now);
  }

  return oauthError("unsupported_grant_type", "Supported grant types are authorization_code and refresh_token.");
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
