import type { ResolveFn } from "./egress-net";
import { fetchEgress } from "./egress";
import { scrubReason } from "@/lib/errors/scrub-reason";

export type OauthDiscoveryDeps = {
  fetchImpl?: typeof fetch;
  resolve?: ResolveFn;
};

export type MetadataResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function refuse(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: scrubReason(reason) };
}

export function parseHttpsUrl(value: string, label: string): MetadataResult<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse(`${label} is not a valid url`);
  }
  if (url.protocol !== "https:") return refuse(`${label} must use https`);
  return { ok: true, value: url };
}

export function parseApprovedHttpsUrl(value: string, label: string, allowedOrigins: string[]): MetadataResult<URL> {
  const parsed = parseHttpsUrl(value, label);
  if (!parsed.ok) return parsed;
  if (!allowedOrigins.includes(parsed.value.origin)) {
    return refuse(`${label} origin is not approved for this connector`);
  }
  return parsed;
}

export function sameIssuer(requested: URL, returned: URL): boolean {
  const normalize = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return normalize(requested) === normalize(returned);
}

export function protectedResourceMetadataUrls(mcpUrl: URL): string[] {
  const bare = `${mcpUrl.origin}/.well-known/oauth-protected-resource`;
  if (mcpUrl.pathname === "/" || mcpUrl.pathname === "") return [bare];
  return [`${bare}${mcpUrl.pathname}`, bare];
}

export function authorizationServerMetadataUrl(issuerUrl: URL): string {
  const bare = `${issuerUrl.origin}/.well-known/oauth-authorization-server`;
  if (issuerUrl.pathname === "/" || issuerUrl.pathname === "") return bare;
  return `${bare}${issuerUrl.pathname}`;
}

export async function fetchMetadataJson(
  url: string,
  approvedOrigins: string[],
  deps: OauthDiscoveryDeps,
  init: RequestInit = {},
): Promise<MetadataResult<unknown>> {
  const result = await fetchEgress(
    url,
    { ...init, headers: { accept: "application/json", ...(init.headers as Record<string, string> | undefined) } },
    { approvedOrigins, fetchImpl: deps.fetchImpl, resolve: deps.resolve },
  );
  if (!result.ok) return result;
  if (!result.response.ok) return refuse(`request to ${url} failed with status ${result.response.status}`);
  try {
    return { ok: true, value: await result.response.json() };
  } catch {
    return refuse(`response from ${url} was not valid json`);
  }
}

export async function fetchWellKnown(
  urls: string[],
  approvedOrigins: string[],
  deps: OauthDiscoveryDeps,
): Promise<MetadataResult<unknown>> {
  let lastReason = "no well known metadata url produced a result";
  for (const url of urls) {
    const result = await fetchMetadataJson(url, approvedOrigins, deps);
    if (result.ok) return result;
    lastReason = result.reason;
  }
  return refuse(lastReason);
}

export type ProtectedResourceMetadata = {
  authorizationServers: unknown[];
  resource?: string;
  scopes?: string[];
};

export function parseProtectedResourceMetadata(
  body: unknown,
  mcpOrigin: string,
): MetadataResult<ProtectedResourceMetadata> {
  if (!body || typeof body !== "object") return refuse("protected resource metadata was not a json object");
  const record = body as Record<string, unknown>;
  const servers = record.authorization_servers;
  if (!Array.isArray(servers) || servers.length === 0) {
    return refuse("protected resource metadata did not name an authorization server");
  }
  const resourceRaw = typeof record.resource === "string" ? record.resource : undefined;
  let resource: string | undefined;
  if (resourceRaw !== undefined) {
    let resourceUrl: URL;
    try {
      resourceUrl = new URL(resourceRaw);
    } catch {
      return refuse("protected resource metadata resource is not a valid url");
    }
    if (resourceUrl.origin !== mcpOrigin) {
      return refuse("protected resource metadata resource origin does not match the connector url");
    }
    resource = resourceRaw;
  }
  const scopesRaw = record.scopes_supported;
  const scopes =
    Array.isArray(scopesRaw) && scopesRaw.every((entry) => typeof entry === "string")
      ? (scopesRaw as string[])
      : undefined;
  return { ok: true, value: { authorizationServers: servers, resource, scopes } };
}

export function selectApprovedAuthorizationServer(
  servers: unknown[],
  mcpOrigin: string,
  approvedOrigins: string[],
): MetadataResult<URL> {
  const allowedOrigins = [mcpOrigin, ...approvedOrigins];
  for (const candidate of servers) {
    if (typeof candidate !== "string") continue;
    const parsed = parseApprovedHttpsUrl(candidate, "authorization server", allowedOrigins);
    if (parsed.ok) return parsed;
  }
  return refuse("no authorization server offered by protected resource metadata has an approved origin");
}

export type AuthorizationServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
  tokenEndpointAuthMethodsSupported?: string[];
};

export function parseAuthorizationServerMetadata(body: unknown): MetadataResult<AuthorizationServerMetadata> {
  if (!body || typeof body !== "object") return refuse("authorization server metadata was not a json object");
  const record = body as Record<string, unknown>;
  const issuer = record.issuer;
  const authorizationEndpoint = record.authorization_endpoint;
  const tokenEndpoint = record.token_endpoint;
  if (typeof issuer !== "string" || typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string") {
    return refuse("authorization server metadata is missing a required endpoint");
  }
  const revocationEndpoint = typeof record.revocation_endpoint === "string" ? record.revocation_endpoint : undefined;
  const registrationEndpoint =
    typeof record.registration_endpoint === "string" ? record.registration_endpoint : undefined;
  const methodsRaw = record.token_endpoint_auth_methods_supported;
  const tokenEndpointAuthMethodsSupported =
    Array.isArray(methodsRaw) && methodsRaw.every((entry) => typeof entry === "string")
      ? (methodsRaw as string[])
      : undefined;
  return {
    ok: true,
    value: {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      revocationEndpoint,
      registrationEndpoint,
      tokenEndpointAuthMethodsSupported,
    },
  };
}

export type TokenEndpointAuthMethod = "client_secret_post" | "client_secret_basic" | "none";

export const DEFAULT_AUTH_METHOD: TokenEndpointAuthMethod = "client_secret_post";

const RECOGNIZED_AUTH_METHODS: readonly TokenEndpointAuthMethod[] = ["client_secret_post", "client_secret_basic", "none"];

function resolveAuthMethod(value: unknown): MetadataResult<TokenEndpointAuthMethod> {
  if (value === undefined || value === null) return { ok: true, value: DEFAULT_AUTH_METHOD };
  if (typeof value === "string" && (RECOGNIZED_AUTH_METHODS as readonly string[]).includes(value)) {
    return { ok: true, value: value as TokenEndpointAuthMethod };
  }
  return refuse("dynamic client registration returned an unrecognized token endpoint auth method");
}

export type RegisteredClient = {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
};

export async function registerClient(
  registrationUrl: string,
  clientName: string,
  redirectUri: string,
  approvedOrigins: string[],
  deps: OauthDiscoveryDeps,
): Promise<MetadataResult<RegisteredClient>> {
  const body = JSON.stringify({
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: DEFAULT_AUTH_METHOD,
  });
  const parsed = await fetchMetadataJson(registrationUrl, approvedOrigins, deps, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!parsed.ok) return parsed;
  if (!parsed.value || typeof parsed.value !== "object") {
    return refuse("dynamic client registration response was not a json object");
  }
  const record = parsed.value as Record<string, unknown>;
  const clientId = record.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    return refuse("dynamic client registration response did not include a client id");
  }
  const clientSecret = typeof record.client_secret === "string" ? record.client_secret : undefined;
  const authMethod = resolveAuthMethod(record.token_endpoint_auth_method);
  if (!authMethod.ok) return authMethod;
  return { ok: true, value: { clientId, clientSecret, tokenEndpointAuthMethod: authMethod.value } };
}
