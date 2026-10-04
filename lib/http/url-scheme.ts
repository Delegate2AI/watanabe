/**
 * The one place that answers "is this URL allowed to carry OIDC secrets and
 * cookies", so the issuer, the discovered endpoints, and `baseUrl` all agree.
 *
 * The rule: `https` always, or `http` when (and only when) the host is
 * loopback. A non-loopback `http` endpoint means an on-path attacker can serve
 * a JWKS, mint an admitted identity, or read a client secret in plaintext, so
 * it is never acceptable outside local development. Loopback `http` has to
 * keep working, or `http://localhost:3100` breaks for every contributor
 * running the app locally.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strips the `[...]` brackets a URL puts around an IPv6 literal host. */
function bareHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(bareHostname(hostname).toLowerCase());
}

/**
 * Whether `url` satisfies the https-or-loopback rule. Returns false (never
 * throws) for a string that will not parse as a URL, so callers can use this
 * directly inside a zod `.refine()` or a never-throws module's own checks.
 */
export function isHttpsOrLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") return isLoopbackHost(parsed.hostname);
    return false;
  } catch {
    return false;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Whether `response` is a redirect that was not followed. True for the
 * classic 3xx statuses, and also for the opaque "type: opaqueredirect"
 * response a real `fetch` call made with `redirect: "manual"` returns (status
 * 0, no headers or body exposed).
 *
 * Both OIDC call sites that post credentials to a provider's HTTP endpoint
 * (`exchange.ts`'s token exchange, `discovery.ts`'s well-known document fetch)
 * pass `redirect: "manual"` and check this before trusting the response.
 * `fetch` follows redirects by default, so an https endpoint could otherwise
 * redirect to an http one an on-path attacker controls, and for a 307 or 308
 * a redirect-following fetch replays the original POST body, including the
 * authorization code, the PKCE verifier, and the client secret, at wherever
 * the redirect points. Refusing to follow, and refusing to trust a response
 * that came back as a redirect, closes both paths.
 */
export function isUnfollowedRedirect(response: Response): boolean {
  return response.type === "opaqueredirect" || REDIRECT_STATUSES.has(response.status);
}
