import { getConfig } from "@/lib/config";
import { isHttpsOrLoopback } from "@/lib/http/url-scheme";
import { fetchEgress } from "./egress";
import { fetchMetadataJson, refuse, type OauthDiscoveryDeps, type TokenEndpointAuthMethod } from "./oauth-discovery-metadata";

export type ConnectorRedirectResult = { ok: true; value: string } | { ok: false; reason: string };

function safeOrigin(value: string | undefined): string | null {
  if (!value || !isHttpsOrLoopback(value)) return null;
  return new URL(value).origin;
}

export function resolveConnectorRedirectUri(): ConnectorRedirectResult {
  const config = getConfig();
  const oidcBaseUrl = config.auth.mode === "oidc" ? config.auth.oidc.baseUrl : undefined;
  const origin = safeOrigin(oidcBaseUrl) ?? safeOrigin(process.env.MCP_PUBLIC_ORIGIN);
  if (!origin) {
    return refuse(
      "no configured origin is available for the connector oauth redirect uri: set auth.oidc.baseUrl or MCP_PUBLIC_ORIGIN",
    );
  }
  return { ok: true, value: new URL("/api/connectors/oauth/callback", origin).toString() };
}

type ClientAuth = {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
};

function basicAuthHeader(clientId: string, clientSecret: string): string {
  const encodedId = encodeURIComponent(clientId);
  const encodedSecret = encodeURIComponent(clientSecret);
  return `Basic ${Buffer.from(`${encodedId}:${encodedSecret}`).toString("base64")}`;
}

function buildTokenRequest(auth: ClientAuth, params: Record<string, string>): { headers: Record<string, string>; body: string } {
  const form = new URLSearchParams({ ...params, client_id: auth.clientId });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };

  if (auth.tokenEndpointAuthMethod === "client_secret_basic" && auth.clientSecret) {
    headers.authorization = basicAuthHeader(auth.clientId, auth.clientSecret);
  } else if (auth.tokenEndpointAuthMethod === "client_secret_post" && auth.clientSecret) {
    form.set("client_secret", auth.clientSecret);
  }

  return { headers, body: form.toString() };
}

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
};

export type TokenExchangeResult = { ok: true; tokens: TokenSet } | { ok: false; reason: string };

function parseTokenResponse(body: unknown): TokenExchangeResult {
  if (!body || typeof body !== "object") return refuse("token response was not a json object");
  const record = body as Record<string, unknown>;
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return refuse("token response did not include an access token");
  }
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token : undefined;
  const tokenType = typeof record.token_type === "string" ? record.token_type : undefined;
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : undefined;
  const expiresAt = expiresIn !== undefined ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined;
  return { ok: true, tokens: { accessToken, refreshToken, expiresAt, tokenType } };
}

export async function exchangeAuthorizationCode(
  config: ClientAuth & { tokenEndpoint: string; resource?: string },
  args: { code: string; verifier: string; redirectUri: string },
  deps: OauthDiscoveryDeps = {},
): Promise<TokenExchangeResult> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.verifier,
  };
  if (config.resource) params.resource = config.resource;
  const { headers, body } = buildTokenRequest(config, params);
  const parsed = await fetchMetadataJson(config.tokenEndpoint, [], deps, { method: "POST", headers, body });
  if (!parsed.ok) return parsed;
  return parseTokenResponse(parsed.value);
}

export async function refreshAccessToken(
  config: ClientAuth & { tokenEndpoint: string; resource?: string },
  refreshToken: string,
  deps: OauthDiscoveryDeps = {},
): Promise<TokenExchangeResult> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };
  if (config.resource) params.resource = config.resource;
  const { headers, body } = buildTokenRequest(config, params);
  const parsed = await fetchMetadataJson(config.tokenEndpoint, [], deps, { method: "POST", headers, body });
  if (!parsed.ok) return parsed;
  return parseTokenResponse(parsed.value);
}

export type ClientSource = "preconfigured" | "dcr";

export type SealedOauthCredential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  mcpUrl?: string;
  resource?: string;
  clientSource?: ClientSource;
};

const RECOGNIZED_AUTH_METHODS: readonly TokenEndpointAuthMethod[] = ["client_secret_post", "client_secret_basic", "none"];

export function parseSealedCredential(value: unknown): SealedOauthCredential | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const accessToken = record.accessToken;
  const tokenEndpoint = record.tokenEndpoint;
  const clientId = record.clientId;
  const tokenEndpointAuthMethod = record.tokenEndpointAuthMethod;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof tokenEndpoint !== "string" ||
    typeof clientId !== "string" ||
    typeof tokenEndpointAuthMethod !== "string" ||
    !(RECOGNIZED_AUTH_METHODS as readonly string[]).includes(tokenEndpointAuthMethod)
  ) {
    return null;
  }
  const refreshToken = typeof record.refreshToken === "string" ? record.refreshToken : undefined;
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : undefined;
  const revocationEndpoint = typeof record.revocationEndpoint === "string" ? record.revocationEndpoint : undefined;
  const clientSecret = typeof record.clientSecret === "string" ? record.clientSecret : undefined;
  const mcpUrl = typeof record.mcpUrl === "string" ? record.mcpUrl : undefined;
  const resource = typeof record.resource === "string" ? record.resource : undefined;
  const clientSource =
    record.clientSource === "preconfigured" || record.clientSource === "dcr" ? record.clientSource : undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt,
    tokenEndpoint,
    revocationEndpoint,
    clientId,
    clientSecret,
    tokenEndpointAuthMethod: tokenEndpointAuthMethod as TokenEndpointAuthMethod,
    mcpUrl,
    resource,
    clientSource,
  };
}

export async function revokeCredentialTokens(
  credential: SealedOauthCredential,
  deps: OauthDiscoveryDeps = {},
): Promise<{ ok: boolean }> {
  if (!credential.revocationEndpoint) return { ok: false };

  try {
    const token = credential.refreshToken ?? credential.accessToken;
    const tokenTypeHint = credential.refreshToken ? "refresh_token" : "access_token";
    const { headers, body } = buildTokenRequest(credential, { token, token_type_hint: tokenTypeHint });
    const result = await fetchEgress(
      credential.revocationEndpoint,
      { method: "POST", headers, body },
      { approvedOrigins: [], fetchImpl: deps.fetchImpl, resolve: deps.resolve },
    );
    return { ok: result.ok && result.response.ok };
  } catch {
    return { ok: false };
  }
}
