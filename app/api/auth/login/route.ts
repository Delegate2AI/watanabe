import { getConfig } from "@/lib/config";
import { log } from "@/lib/log";
import { serializeCookie } from "@/lib/http/cookies";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { transientCookieOptions, withHostPrefix } from "@/lib/auth/session";
import { discover } from "@/lib/auth/oidc/discovery";
import { issuerFor } from "@/lib/auth/oidc/presets";
import {
  newAuthorizationRequest,
  STATE_COOKIE,
  NONCE_COOKIE,
  VERIFIER_COOKIE,
} from "@/lib/auth/oidc/authorize";
import { RETURN_COOKIE, safeReturnPath } from "@/lib/auth/oidc/return-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/login: start an OIDC sign-in.
 *
 * Mints state, nonce, and a PKCE verifier, parks all three plus the return path
 * in short-lived httpOnly cookies, and redirects to the provider. 404 in every
 * other auth mode: a live sign-in route on a portal that authenticates some
 * other way is a second door nobody asked for.
 */
export async function GET(request: Request): Promise<Response> {
  const { auth } = getConfig();
  if (auth.mode !== "oidc") return new Response("Not Found", { status: 404 });
  const config = auth.oidc;

  // Starting a login is a human act with a redirect in the middle. Nobody does
  // it thirty times a minute, and each call mints three 32-byte secrets. Its
  // own namespace so eviction pressure here can never renew an allowance the
  // callback route or the external shared-doc link path was relying on.
  if (!rateLimit("oidc-login", clientKey(request.headers), 30, 60_000)) {
    return new Response("Too Many Requests", { status: 429 });
  }

  const issuer = issuerFor(config);
  const endpoints = issuer ? await discover(issuer, AbortSignal.timeout(10_000)) : null;
  if (!endpoints) {
    log.warn("oidc login start failed", { reason: "provider_unreachable" });
    return Response.redirect(`${config.baseUrl.replace(/\/+$/, "")}/login?error=provider_unreachable`, 302);
  }

  const { url, state, nonce, verifier } = newAuthorizationRequest(config, endpoints);
  const next = safeReturnPath(new URL(request.url).searchParams.get("next"));
  const options = transientCookieOptions(config);

  const headers = new Headers({ location: url });
  headers.append("set-cookie", serializeCookie(withHostPrefix(config.baseUrl, STATE_COOKIE), state, options));
  headers.append("set-cookie", serializeCookie(withHostPrefix(config.baseUrl, NONCE_COOKIE), nonce, options));
  headers.append(
    "set-cookie",
    serializeCookie(withHostPrefix(config.baseUrl, VERIFIER_COOKIE), verifier, options),
  );
  headers.append("set-cookie", serializeCookie(withHostPrefix(config.baseUrl, RETURN_COOKIE), next, options));
  return new Response(null, { status: 302, headers });
}
