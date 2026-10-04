import { getConfig } from "@/lib/config";
import { log } from "@/lib/log";
import { expireCookie, readCookie } from "@/lib/http/cookies";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { mintSession, sessionSetCookie, transientCookieOptions, withHostPrefix } from "@/lib/auth/session";
import { STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE } from "@/lib/auth/oidc/authorize";
import { RETURN_COOKIE, safeReturnPath } from "@/lib/auth/oidc/return-path";
import { completeLogin, type LoginErrorCode } from "@/lib/auth/oidc/flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/callback: the provider's redirect back.
 *
 * The decisions live in `completeLogin`. This handler reads cookies, clears the
 * four transient ones whatever the outcome (rate-limited, rejected, or
 * succeeded alike), and turns the result into a redirect. Every failure lands
 * on /login with a reason code: never a 500, and never a stack trace to the
 * open internet.
 */
export async function GET(request: Request): Promise<Response> {
  const { auth } = getConfig();
  if (auth.mode !== "oidc") return new Response("Not Found", { status: 404 });
  const config = auth.oidc;

  const origin = config.baseUrl.replace(/\/+$/, "");
  const options = transientCookieOptions(config);
  const stateCookieName = withHostPrefix(config.baseUrl, STATE_COOKIE);
  const nonceCookieName = withHostPrefix(config.baseUrl, NONCE_COOKIE);
  const verifierCookieName = withHostPrefix(config.baseUrl, VERIFIER_COOKIE);
  const returnCookieName = withHostPrefix(config.baseUrl, RETURN_COOKIE);
  const clearTransients = (headers: Headers) => {
    for (const name of [stateCookieName, nonceCookieName, verifierCookieName, returnCookieName]) {
      headers.append("set-cookie", expireCookie(name, options));
    }
  };

  // Without this, an unauthenticated caller can set the three transient
  // cookies themselves, pick a state that matches, and hit this route
  // repeatedly: exchangeCode still fires a real outbound POST to the
  // provider's token endpoint under this deployment's own client_id and
  // client_secret. Own namespace, same as the login route's limit, so the two
  // (and the external shared-doc link path) never share a budget or evict
  // each other's buckets. Clears the transient cookies on the way out like
  // every other exit: a rate-limited caller is not exempt from that cleanup.
  if (!rateLimit("oidc-callback", clientKey(request.headers), 30, 60_000)) {
    const headers = new Headers();
    clearTransients(headers);
    return new Response("Too Many Requests", { status: 429, headers });
  }

  const cookieHeader = request.headers.get("cookie");
  const params = new URL(request.url).searchParams;

  const failure = (reason: LoginErrorCode, { clear = true }: { clear?: boolean } = {}): Response => {
    log.warn("oidc login rejected", { reason });
    const headers = new Headers({ location: `${origin}/login?error=${reason}` });
    if (clear) clearTransients(headers);
    return new Response(null, { status: 302, headers });
  };

  const code = params.get("code");
  const error = params.get("error");

  if (!code && !error) return failure("missing_params");

  // A provider that refuses (consent denied, for instance) redirects back with
  // `error` and no code. That is a rejected sign-in, not a broken one, but
  // only once its `state` is shown to belong to the pending attempt these
  // cookies describe: state is validated here BEFORE the error is honored,
  // exactly like the success path validates state before trusting anything
  // else. Without this, a cross-site navigation to
  // `?error=access_denied` (no code, and no way to know the random state
  // value sitting in a victim's httpOnly cookie) could cancel a victim's real
  // pending sign-in merely by tripping the cookie cleanup below. A state that
  // does not match proves this response is not part of the flow that set
  // these cookies, so it is reported as `state_mismatch` and must not touch
  // them: only a state-matched error response clears them and reports
  // `not_allowed`.
  if (error) {
    const state = params.get("state");
    const stateCookie = readCookie(cookieHeader, stateCookieName);
    if (!state || !stateCookie || state !== stateCookie) {
      return failure("state_mismatch", { clear: false });
    }
    return failure("not_allowed");
  }

  const result = await completeLogin({
    config,
    clientSecret: process.env.PORTAL_OIDC_CLIENT_SECRET ?? "",
    code: code ?? "",
    state: params.get("state") ?? "",
    stateCookie: readCookie(cookieHeader, stateCookieName),
    nonceCookie: readCookie(cookieHeader, nonceCookieName),
    verifierCookie: readCookie(cookieHeader, verifierCookieName),
    signal: AbortSignal.timeout(10_000),
  });

  if (!result.ok) return failure(result.reason);

  const token = await mintSession(result.identity, config);
  if (!token) return failure("token_invalid");

  const destination = safeReturnPath(readCookie(cookieHeader, returnCookieName));
  const headers = new Headers({ location: `${origin}${destination}` });
  clearTransients(headers);
  headers.append("set-cookie", sessionSetCookie(token, config));
  log.info("oidc login succeeded", { email: result.identity.email });
  return new Response(null, { status: 302, headers });
}
