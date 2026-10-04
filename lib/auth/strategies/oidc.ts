import type { OidcConfig } from "@/lib/config/schema";
import { readCookie } from "@/lib/http/cookies";
import { verifySession, withHostPrefix } from "../session";
import type { Identity, HeaderSource } from "../types";

/**
 * The request-path half of the OIDC mode (2026-07-27 spec).
 *
 * Deliberately small: the login flow lives in routes, and by the time a request
 * reaches here the only question left is whether this cookie is a session this
 * portal signed. Everything else, the provider, the tokens, admission, happened
 * once at sign-in.
 *
 * Never throws. A missing, malformed, expired, or forged cookie is null, which
 * the caller turns into a 401 or a redirect to /login.
 */
export async function resolve(
  headers: HeaderSource,
  config: OidcConfig,
): Promise<Identity | null> {
  const token = readCookie(headers.get("cookie"), withHostPrefix(config.baseUrl, config.cookieName));
  if (!token) return null;
  return verifySession(token);
}
