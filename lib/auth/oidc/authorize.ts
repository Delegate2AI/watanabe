import { createHash, randomBytes } from "node:crypto";
import type { OidcConfig } from "@/lib/config/schema";
import type { ProviderEndpoints } from "./discovery";
import { presetFor } from "./presets";

/**
 * Build the authorization request: the redirect that sends someone to their
 * identity provider, plus the three secrets the callback checks it against.
 *
 * PKCE is unconditional. It costs one hash and it is what stops a stolen
 * authorization code from being redeemed by anyone but this process, so
 * "the provider does not require it" is not a reason to skip it.
 */

export const STATE_COOKIE = "portal_oidc_state";
export const NONCE_COOKIE = "portal_oidc_nonce";
export const VERIFIER_COOKIE = "portal_oidc_verifier";

/** 32 random bytes, base64url, which is 43 characters. */
const secret = () => randomBytes(32).toString("base64url");

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = secret();
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * Always from the configured `baseUrl`, never from a request header. This value
 * decides where the provider delivers the authorization code, so letting a
 * caller influence it hands out codes.
 */
export function redirectUri(config: OidcConfig): string {
  return `${config.baseUrl.replace(/\/+$/, "")}/api/auth/callback`;
}

export function buildAuthorizationUrl(args: {
  endpoints: ProviderEndpoints;
  config: OidcConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const { endpoints, config, state, nonce, codeChallenge } = args;
  const preset = presetFor(config);
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(preset.extraAuthParams)) {
    url.searchParams.set(key, value);
  }
  // A hint only, and only when it is unambiguous. Admission is enforced on the
  // way back regardless of what the provider does with this.
  if (preset.requireHostedDomain && config.allowedDomains.length === 1) {
    url.searchParams.set("hd", config.allowedDomains[0] as string);
  }
  return url.toString();
}

export function newAuthorizationRequest(
  config: OidcConfig,
  endpoints: ProviderEndpoints,
): { url: string; state: string; nonce: string; verifier: string } {
  const state = secret();
  const nonce = secret();
  const { verifier, challenge } = generatePkce();
  return {
    url: buildAuthorizationUrl({ endpoints, config, state, nonce, codeChallenge: challenge }),
    state,
    nonce,
    verifier,
  };
}
