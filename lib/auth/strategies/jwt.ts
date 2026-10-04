import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { log } from "@/lib/log";
import { readCookie } from "@/lib/http/cookies";
import type { Identity, HeaderSource } from "../types";

/**
 * JWT verification strategy (spec 16).
 *
 * Verifies signature, `exp`, `nbf`, `iss`, and `aud`, then reads the configured
 * email claim. This is the only strategy that talks to an identity provider,
 * and only for RS256 (fetching its JWKS).
 *
 * Every failure resolves to `null`, never a thrown error: a bad token is a 401,
 * not a 500. A malformed `Authorization` header from the open internet must not
 * be able to produce a stack trace.
 */

export interface JwtConfig {
  algorithm: "RS256" | "HS256";
  jwksUrl?: string;
  secret?: string;
  issuer: string;
  audience: string;
  source: "cookie" | "bearer";
  cookieName: string;
  emailClaim: string;
  nameClaim: string;
}

/**
 * `createRemoteJWKSet` maintains its own key cache and rate-limits refetches,
 * so it must be created ONCE per JWKS URL. Rebuilding it per request would hit
 * the IdP on every page view and defeat that caching entirely.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

function jwks(url: string): JWTVerifyGetKey {
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, set);
  }
  return set;
}

/** Test seam: drop cached remote key sets between tests. */
export function resetJwksCacheForTests(): void {
  jwksCache.clear();
}

/**
 * Read the token from wherever the config says it lives. Cookie reading is
 * shared with the oidc strategy via `lib/http/cookies.ts`, so both modes agree
 * on what a cookie named `portal_session` is.
 */
function extractToken(headers: HeaderSource, config: JwtConfig): string | null {
  if (config.source === "bearer") {
    const authorization = headers.get("authorization");
    if (!authorization) return null;
    const [scheme, ...rest] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "bearer") return null;
    const token = rest.join(" ").trim();
    return token || null;
  }
  return readCookie(headers.get("cookie"), config.cookieName);
}

/** A claim is only usable as an identity if it is a non-empty string. */
function stringClaim(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function resolve(headers: HeaderSource, config: JwtConfig): Promise<Identity | null> {
  const token = extractToken(headers, config);
  if (!token) return null;

  try {
    const options = {
      issuer: config.issuer,
      audience: config.audience,
      // Pin the algorithm. Without this, a token could nominate its own `alg`
      // and an attacker could present an HS256 token signed with the PUBLIC
      // RSA key from the JWKS, which the verifier would happily accept.
      algorithms: [config.algorithm],
    };

    // `jwtVerify` overloads on the key (a JWKS resolver function vs raw key
    // material), so the call is branched rather than the key: a union of the
    // two satisfies neither overload.
    const { payload } =
      config.algorithm === "RS256"
        ? await jwtVerify(token, jwks(config.jwksUrl as string), options)
        : await jwtVerify(token, new TextEncoder().encode(config.secret as string), options);

    const email = stringClaim(payload, config.emailClaim);
    if (!email) {
      log.warn("rejected JWT: missing or non-string email claim", { claim: config.emailClaim });
      return null;
    }
    return { email, name: stringClaim(payload, config.nameClaim) };
  } catch (err) {
    // Never log the token. `code` distinguishes expiry from a bad signature.
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "unknown";
    log.warn("rejected JWT", { code });
    return null;
  }
}
