/**
 * What this deployment advertises as an OAuth authorization server
 * (spec 2026-09-05, D1).
 *
 * Everything derives from one configured value, `MCP_PUBLIC_ORIGIN`, and never
 * from the request. An issuer taken from the `Host` header is attacker
 * controllable, and that is how a token minted for one audience gets spent at
 * another. The cost of the explicit value is one line of helm per environment.
 */

export interface AuthorizationServerConfig {
  issuer: string;
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
}

/**
 * An absolute origin, or null.
 *
 * `http` is refused except on loopback. Validated here rather than at the point
 * of use because these values reach `new URL()` on paths that answer
 * unauthenticated requests: a deployment configured wrongly has to read as
 * "not configured", never as "broken".
 */
function publicOrigin(): string | null {
  const candidate = process.env.MCP_PUBLIC_ORIGIN?.trim();
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return null;
  // `origin` drops any path, query or trailing slash the operator left on it.
  return parsed.origin;
}

export function authorizationServerConfig(): AuthorizationServerConfig | null {
  const origin = publicOrigin();
  if (!origin) return null;
  return {
    issuer: origin,
    resource: `${origin}/api/mcp`,
    authorizationEndpoint: `${origin}/oauth/authorize`,
    tokenEndpoint: `${origin}/api/oauth/token`,
    registrationEndpoint: `${origin}/api/oauth/register`,
  };
}

/**
 * The RFC 8414 document.
 *
 * It advertises exactly what is implemented and nothing more. `S256` alone,
 * because `plain` PKCE protects nothing; `none` alone for client authentication,
 * because no client secret is ever issued; and one scope, because the tool set a
 * caller gets is decided by their roles and clearance at call time and a scope
 * promising anything else would be a second authorization model to keep in step
 * with the first.
 */
export function authorizationServerMetadata(): AuthorizationServerMetadata | null {
  const config = authorizationServerConfig();
  if (!config) return null;
  return {
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    registration_endpoint: config.registrationEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}
