import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { OidcConfig } from "@/lib/config/schema";
import { log } from "@/lib/log";
import { serializeCookie, expireCookie, type CookieOptions } from "@/lib/http/cookies";
import type { Identity } from "./types";

/**
 * The portal's own session cookie: a stateless HS256 JWT the portal signs for
 * itself after an OIDC login.
 *
 * Stateless on purpose. There is no user table and no session table in this app,
 * and a signed cookie needs neither, works across replicas, and costs no DB read
 * per request. The price is no per-session revoke: signing out clears the
 * cookie, and rotating PORTAL_SESSION_SECRET invalidates every session at once.
 *
 * The secret is read from the environment on each use rather than captured at
 * import, so a test can stub it and a rotation takes effect without a restart.
 * A missing or too-short secret yields null rather than throwing, because this
 * module sits on the request path: `assertOidcConfigured` is what turns that
 * misconfiguration into a loud failure, at boot, where it belongs.
 */

const ISSUER = "watanabe-portal";
const AUDIENCE = "portal-session";
const MIN_SECRET_LENGTH = 32;

function secretKey(): Uint8Array | null {
  const secret = process.env.PORTAL_SESSION_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Whether cookies carry the `Secure` flag, decided by the scheme of the portal's
 * own configured origin.
 *
 * Not `NODE_ENV`, because an unset or misspelled `NODE_ENV` must never decide a
 * security flag, and not a hardcoded `true`, because that silently drops every
 * cookie on an `http://localhost:3100` dev run and presents as "login does
 * nothing". A URL that will not parse fails closed to secure.
 */
export function isSecureBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === "https:";
  } catch {
    return true;
  }
}

/**
 * The `__Host-` cookie-name prefix, applied whenever the cookie is `Secure`.
 *
 * This portal is deployed under a shared parent domain alongside other
 * applications. Without `__Host-`, a hostile sibling subdomain can set a
 * `Domain`-scoped cookie with the same name as any of the state, nonce,
 * verifier, return-path, or session cookies (cookie tossing), and nothing on
 * this side can tell that cookie apart from the host-only one this portal set.
 * That is enough to fix a victim's state, nonce, and PKCE verifier ahead of
 * time and deliver an authorization response for the attacker's own account,
 * landing the victim in a session under the attacker's identity. `__Host-`
 * closes this: a browser only accepts a `__Host-`-prefixed `Set-Cookie` when it
 * also carries `Secure`, `Path=/`, and no `Domain` attribute, which makes the
 * cookie host-only and un-toss-able from a sibling subdomain.
 *
 * Gated on `isSecureBaseUrl`, the same predicate that already decides the
 * `Secure` flag, rather than a separate condition: a browser rejects a
 * `__Host-` cookie with no `Secure` flag outright, so the two must always
 * agree. That is also why this stays unprefixed on `http://localhost`: local
 * development runs without TLS, and a `__Host-` cookie there would simply
 * never be set.
 *
 * Kept next to `isSecureBaseUrl` and the cookie option builders so every
 * caller (the login and callback routes, and the `oidc` strategy) derives the
 * same name from the same rule instead of each reimplementing it.
 */
export function withHostPrefix(baseUrl: string, name: string): string {
  return isSecureBaseUrl(baseUrl) ? `__Host-${name}` : name;
}

export function sessionCookieOptions(config: OidcConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureBaseUrl(config.baseUrl),
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionTtlHours * 3600,
  };
}

/** State, nonce, verifier, and return path: alive only for one sign-in. */
export function transientCookieOptions(config: OidcConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureBaseUrl(config.baseUrl),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  };
}

export async function mintSession(identity: Identity, config: OidcConfig): Promise<string | null> {
  const key = secretKey();
  if (!key) {
    log.error("cannot mint a session: PORTAL_SESSION_SECRET is unset or too short");
    return null;
  }
  return new SignJWT({ email: identity.email, ...(identity.name ? { name: identity.name } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlHours}h`)
    .sign(key);
}

export async function verifySession(token: string): Promise<Identity | null> {
  if (!token) return null;
  const key = secretKey();
  if (!key) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    if (!email) return null;
    const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : undefined;
    return { email, ...(name ? { name } : {}) };
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) {
      log.warn("rejected portal session cookie", { code: error.code });
      return null;
    }
    return null;
  }
}

export function sessionSetCookie(token: string, config: OidcConfig): string {
  return serializeCookie(withHostPrefix(config.baseUrl, config.cookieName), token, sessionCookieOptions(config));
}

export function sessionClearCookie(config: OidcConfig): string {
  return expireCookie(withHostPrefix(config.baseUrl, config.cookieName), {
    httpOnly: true,
    secure: isSecureBaseUrl(config.baseUrl),
    sameSite: "lax",
    path: "/",
  });
}
