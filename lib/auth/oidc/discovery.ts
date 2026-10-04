import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { log } from "@/lib/log";
import { isHttpsOrLoopback, isUnfollowedRedirect } from "@/lib/http/url-scheme";

/**
 * OIDC discovery: turn an issuer URL into the three endpoints the flow needs.
 *
 * Never throws. A provider that is down, slow, or serving nonsense yields null,
 * which the routes surface as `provider_unreachable` on the login page. An
 * outage at the IdP must not be a 500 from this portal.
 *
 * Two caches, both process-local and both deliberate. Endpoints are cached
 * because the document is static and fetching it on every sign-in would add a
 * round trip to a flow that already has three. `createRemoteJWKSet` is cached
 * because it maintains its own key cache and rate-limits its own refetches, so
 * rebuilding it per request would defeat that entirely (the same reason
 * `strategies/jwt.ts` keeps its own map).
 */

const documentSchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});

export interface ProviderEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const endpointCache = new Map<string, ProviderEndpoints>();
const jwksCache = new Map<string, JWTVerifyGetKey>();

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export async function discover(
  issuer: string,
  signal: AbortSignal,
): Promise<ProviderEndpoints | null> {
  const key = trimSlash(issuer);
  const cached = endpointCache.get(key);
  if (cached) return cached;

  const url = `${key}/.well-known/openid-configuration`;
  try {
    // `redirect: "manual"` for the same reason exchange.ts uses it: an https
    // issuer redirecting discovery to an http host would let an on-path
    // attacker hand back forged endpoints and a forged JWKS, and following
    // that redirect automatically is exactly how that document would end up
    // trusted. A discovery response that redirects is refused outright rather
    // than followed.
    const response = await fetch(url, {
      signal,
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    if (isUnfollowedRedirect(response)) {
      log.warn("oidc discovery redirected", { issuer: key, status: response.status });
      return null;
    }
    if (!response.ok) {
      log.warn("oidc discovery failed", { issuer: key, status: response.status });
      return null;
    }
    const parsed = documentSchema.safeParse(await response.json());
    if (!parsed.success) {
      log.warn("oidc discovery document malformed", { issuer: key });
      return null;
    }
    // The document must claim the issuer we asked for. Without this check a
    // redirect or a misconfigured host could hand us another provider's
    // endpoints while we go on believing we are talking to this one.
    if (trimSlash(parsed.data.issuer) !== key) {
      log.warn("oidc discovery issuer mismatch", { issuer: key, got: parsed.data.issuer });
      return null;
    }
    const endpoints: ProviderEndpoints = {
      issuer: parsed.data.issuer,
      authorizationEndpoint: parsed.data.authorization_endpoint,
      tokenEndpoint: parsed.data.token_endpoint,
      jwksUri: parsed.data.jwks_uri,
    };
    // An `http` endpoint on a non-loopback host means an on-path attacker can
    // serve a forged JWKS or read the client secret this portal posts to the
    // token endpoint in plaintext. A malicious or misconfigured discovery
    // document is exactly the kind of hostile input this function has to
    // survive, so this is checked here rather than trusted to the schema,
    // which only ever sees the CONFIGURED issuer, never what a provider's own
    // document hands back.
    const insecure = [endpoints.authorizationEndpoint, endpoints.tokenEndpoint, endpoints.jwksUri].find(
      (url) => !isHttpsOrLoopback(url),
    );
    if (insecure) {
      log.warn("oidc discovery endpoint uses an insecure scheme", { issuer: key });
      return null;
    }
    endpointCache.set(key, endpoints);
    return endpoints;
  } catch (error) {
    log.warn("oidc discovery unreachable", { issuer: key, error: String(error) });
    return null;
  }
}

export function jwksFor(endpoints: ProviderEndpoints): JWTVerifyGetKey {
  let set = jwksCache.get(endpoints.jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(endpoints.jwksUri));
    jwksCache.set(endpoints.jwksUri, set);
  }
  return set;
}

/** Test seam: drop cached documents and key sets between cases. */
export function resetDiscoveryCacheForTests(): void {
  endpointCache.clear();
  jwksCache.clear();
}
