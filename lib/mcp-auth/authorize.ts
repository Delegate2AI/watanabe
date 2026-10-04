import type { Database as DatabaseType } from "better-sqlite3";
import { getClient, type OAuthClient } from "./clients";

/**
 * Validating an authorization request (spec 2026-09-05, D5).
 *
 * The split that matters is between the two ways of refusing. If the client or
 * the redirect URI is wrong, this must NOT redirect: sending an error to an
 * unverified address is how an authorization endpoint becomes an open redirect.
 * Those refusals are displayed to the person instead. Only once the redirect
 * URI is known to belong to the registered client may an error be sent to it,
 * which is what the OAuth error parameters are for.
 *
 * Redirect URIs are compared by exact string equality against the registered
 * list. No normalization, no prefix, no wildcard: a loose match is the defect
 * that turns this endpoint into token theft.
 */

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

export type AuthorizeCheck =
  | { ok: true; request: AuthorizeRequest; client: OAuthClient }
  /** Refused before the redirect URI was trusted. Show this; never redirect. */
  | { ok: false; kind: "display"; reason: string }
  /** Refused after the redirect URI was verified, so the client may be told. */
  | { ok: false; kind: "redirect"; redirectUri: string; error: string; state: string | null };

export function checkAuthorizeParams(db: DatabaseType, params: URLSearchParams): AuthorizeCheck {
  const clientId = params.get("client_id")?.trim() ?? "";
  if (!clientId) return { ok: false, kind: "display", reason: "This link is missing its client_id." };

  const client = getClient(db, clientId);
  if (!client) {
    return { ok: false, kind: "display", reason: "This application is not registered with this workspace." };
  }

  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      kind: "display",
      reason: "This link asks to return to an address the application did not register.",
    };
  }

  // Past this point the redirect URI is the client's own, so an error may be
  // delivered to it rather than shown here.
  const state = params.get("state");
  const fail = (error: string): AuthorizeCheck => ({ ok: false, kind: "redirect", redirectUri, error, state });

  if ((params.get("response_type") ?? "") !== "code") return fail("unsupported_response_type");
  if ((params.get("code_challenge_method") ?? "") !== "S256") return fail("invalid_request");

  const codeChallenge = params.get("code_challenge")?.trim() ?? "";
  if (!codeChallenge) return fail("invalid_request");

  const scope = params.get("scope")?.trim();
  if (scope !== undefined && scope !== "" && scope !== "mcp") return fail("invalid_scope");

  return { ok: true, request: { clientId, redirectUri, codeChallenge, state }, client };
}

/** Append parameters to a redirect URI without disturbing what it already carries. */
export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}
