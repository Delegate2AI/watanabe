import { createResolve } from "./egress-fixtures";
import type { ConnectorEntry } from "./types";

export const resolve = createResolve();

export const REDIRECT_URI = "https://portal.example.com/api/connectors/oauth/callback";

export function entry(overrides: Partial<ConnectorEntry> = {}): ConnectorEntry {
  return {
    slug: "linear",
    title: "Linear",
    transport: "http",
    url: "https://api.example.com/mcp",
    groups: ["eng"],
    auth: "oauth",
    ...overrides,
  };
}

export function prmBody(authorizationServers: string | string[], extra: Record<string, unknown> = {}) {
  return () =>
    new Response(
      JSON.stringify({
        resource: "https://api.example.com/mcp",
        authorization_servers: Array.isArray(authorizationServers) ? authorizationServers : [authorizationServers],
        scopes_supported: ["read", "write"],
        ...extra,
      }),
      { status: 200 },
    );
}

export function asBody(issuer: string, overrides: Record<string, unknown> = {}) {
  return () =>
    new Response(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/revoke`,
        ...overrides,
      }),
      { status: 200 },
    );
}
