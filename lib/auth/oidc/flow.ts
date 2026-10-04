import type { OidcConfig } from "@/lib/config/schema";
import type { Identity } from "@/lib/auth/types";
import { isAdmitted } from "./admission";
import { discover, jwksFor } from "./discovery";
import { exchangeCode } from "./exchange";
import { issuerFor } from "./presets";
import { verifyIdToken } from "./verify";

/**
 * Everything the callback route decides, with no Next request context in sight.
 *
 * The route's own job is reduced to reading cookies and writing them back, so
 * the security-relevant sequence (state, exchange, verify, admit) is testable
 * directly and reads top to bottom in one function.
 */

export type LoginErrorCode =
  | "missing_params"
  | "state_mismatch"
  | "exchange_failed"
  | "token_invalid"
  | "not_allowed"
  | "provider_unreachable";

export type LoginResult =
  | { ok: true; identity: Identity }
  | { ok: false; reason: LoginErrorCode };

export async function completeLogin(args: {
  config: OidcConfig;
  clientSecret: string;
  code: string;
  state: string;
  stateCookie: string | null;
  nonceCookie: string | null;
  verifierCookie: string | null;
  signal: AbortSignal;
}): Promise<LoginResult> {
  const { config, clientSecret, code, state, stateCookie, nonceCookie, verifierCookie, signal } = args;

  if (!code || !state || !stateCookie || !nonceCookie || !verifierCookie) {
    return { ok: false, reason: "missing_params" };
  }
  // Login-CSRF check, and it happens before anything else is trusted or fetched.
  if (state !== stateCookie) return { ok: false, reason: "state_mismatch" };

  const issuer = issuerFor(config);
  if (!issuer) return { ok: false, reason: "provider_unreachable" };

  const endpoints = await discover(issuer, signal);
  if (!endpoints) return { ok: false, reason: "provider_unreachable" };

  const idToken = await exchangeCode({
    endpoints,
    config,
    clientSecret,
    code,
    codeVerifier: verifierCookie,
    signal,
  });
  if (!idToken) return { ok: false, reason: "exchange_failed" };

  const claims = await verifyIdToken(idToken, {
    getKey: jwksFor(endpoints),
    // Trusting endpoints.issuer here is safe only because discover() already
    // checked the discovery document's own issuer field against the issuer we
    // asked for and returned null on a mismatch. If that check is ever
    // removed, this line silently starts verifying tokens against whatever
    // issuer value the document claimed, not the one this deployment actually
    // configured.
    issuer: endpoints.issuer,
    clientId: config.clientId,
    nonce: nonceCookie,
    emailClaim: config.emailClaim,
    nameClaim: config.nameClaim,
  });
  if (!claims) return { ok: false, reason: "token_invalid" };

  if (!isAdmitted(claims, config)) return { ok: false, reason: "not_allowed" };

  return {
    ok: true,
    identity: { email: claims.email, ...(claims.name ? { name: claims.name } : {}) },
  };
}
