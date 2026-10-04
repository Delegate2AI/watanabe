import { z } from "zod";
import type { OidcConfig } from "@/lib/config/schema";
import { log } from "@/lib/log";
import { isUnfollowedRedirect } from "@/lib/http/url-scheme";
import type { ProviderEndpoints } from "./discovery";
import { redirectUri } from "./authorize";

/**
 * Redeem an authorization code for an ID token.
 *
 * Returns null on every failure, and the caller turns that into one reason code
 * on the login page. The code, the verifier, and the client secret never reach a
 * log line: a token endpoint that starts rejecting exchanges is exactly when
 * someone turns up log verbosity, and that is the worst moment to be printing
 * credentials.
 */

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

export async function exchangeCode(args: {
  endpoints: ProviderEndpoints;
  config: OidcConfig;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  signal: AbortSignal;
}): Promise<string | null> {
  const { endpoints, config, clientSecret, code, codeVerifier, signal } = args;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    client_id: config.clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(config),
  });

  try {
    const response = await fetch(endpoints.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      // `fetch` follows redirects by default, and a POST redirected 307 or 308
      // replays this exact body, including the code, the verifier, and the
      // client secret, at wherever the redirect points, possibly a plaintext
      // http host. A token endpoint that redirects is refusing to answer
      // directly, so it is never followed: `manual` stops fetch from doing so
      // itself, and isUnfollowedRedirect below refuses to trust the result.
      redirect: "manual",
      signal,
    });
    if (isUnfollowedRedirect(response)) {
      log.warn("oidc token exchange redirected", { issuer: endpoints.issuer, status: response.status });
      return null;
    }
    if (!response.ok) {
      log.warn("oidc token exchange rejected", { issuer: endpoints.issuer, status: response.status });
      return null;
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("oidc token response carried no id_token", { issuer: endpoints.issuer });
      return null;
    }
    return parsed.data.id_token;
  } catch (error) {
    log.warn("oidc token exchange failed", { issuer: endpoints.issuer, error: String(error) });
    return null;
  }
}
