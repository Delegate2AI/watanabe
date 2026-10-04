import { unauthorized } from "@/lib/auth/identity";
import { isMcpAuthServerReady } from "./config";
import { authorizationServerConfig } from "./server-config";

const WELL_KNOWN = "/.well-known/oauth-protected-resource";

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
}

/**
 * Where this resource's RFC 9728 metadata document lives.
 *
 * The well-known segment is a PREFIX on the resource's path, not a sibling of
 * it: a resource at `https://host/api/mcp` publishes at
 * `https://host/.well-known/oauth-protected-resource/api/mcp`. Getting this
 * wrong is silent, since a client that cannot find the document simply reports
 * that the server needs no authorization.
 */
export function resourceMetadataUrl(): string | null {
  const config = authorizationServerConfig();
  if (!config) return null;
  const resource = new URL(config.resource);
  return `${resource.origin}${WELL_KNOWN}${resource.pathname}`;
}

export function protectedResourceMetadata(): ProtectedResourceMetadata | null {
  const config = authorizationServerConfig();
  if (!config) return null;
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

/**
 * The 401 this route answers with.
 *
 * Identical in body to every other refusal the portal issues, so a caller still
 * cannot tell a live credential from an invented one, but carrying the
 * `WWW-Authenticate` challenge that lets a client discover how to authenticate.
 * That header is the whole bootstrap: without it a browser-based MCP client has
 * no way to learn which authorization server to send its user to.
 */
export function mcpUnauthorized(): Response {
  const response = unauthorized();
  // Gated on the live feature state, not merely on configuration. With the
  // flag off the metadata route answers 404, so a challenge naming it would
  // send a client to a dead end AND would change this route's flag-off bytes,
  // which is the one thing a kill switch must not do.
  const metadata = isMcpAuthServerReady() ? resourceMetadataUrl() : null;
  if (!metadata) return response;
  const headers = new Headers(response.headers);
  headers.set("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`);
  return new Response(response.body, { status: response.status, headers });
}
