import { createHash } from "node:crypto";
import { interpolate, ConfigError } from "@/lib/config/interpolate";
import type { ConnectorEntry } from "./types";
import { resolveAuthorizationServerMetadata } from "./oauth-discovery-resolve";
import {
  DEFAULT_AUTH_METHOD,
  refuse,
  registerClient,
  type OauthDiscoveryDeps,
  type TokenEndpointAuthMethod,
} from "./oauth-discovery-metadata";

export type { OauthDiscoveryDeps } from "./oauth-discovery-metadata";

export type OauthConfig = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  scopes?: string[];
  resource: string;
  fingerprint: string;
};

export type OauthConfigResult = { ok: true; config: OauthConfig } | { ok: false; reason: string };

type FingerprintInput = {
  mcpUrl: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes?: string[];
  resource: string;
};

export function computeOauthFingerprint(input: FingerprintInput): string {
  const scopes = input.scopes ? [...input.scopes].sort() : undefined;
  const material = {
    mcpUrl: input.mcpUrl,
    issuer: input.issuer,
    authorizationEndpoint: input.authorizationEndpoint,
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    scopes,
    resource: input.resource,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 16);
}

function resolveClientSecret(reference: string): { ok: true; value: string } | { ok: false; reason: string } {
  try {
    return { ok: true, value: interpolate(reference, process.env, "oauthClientSecret") };
  } catch (error) {
    if (error instanceof ConfigError) return refuse("oauth client secret is not set in the environment");
    return refuse("oauth client secret could not be resolved");
  }
}

type ResolvedClient = { clientId: string; clientSecret?: string; tokenEndpointAuthMethod: TokenEndpointAuthMethod };

const RFC8414_DEFAULT_AUTH_METHOD: TokenEndpointAuthMethod = "client_secret_basic";

function resolvePreconfiguredAuthMethod(
  methodsSupported: string[] | undefined,
): { ok: true; value: TokenEndpointAuthMethod } | { ok: false; reason: string } {
  if (methodsSupported === undefined) return { ok: true, value: RFC8414_DEFAULT_AUTH_METHOD };
  if (methodsSupported.includes("client_secret_post")) return { ok: true, value: "client_secret_post" };
  if (methodsSupported.includes("client_secret_basic")) return { ok: true, value: RFC8414_DEFAULT_AUTH_METHOD };
  return refuse("authorization server does not support a recognized client secret auth method");
}

async function resolveClient(
  entry: ConnectorEntry,
  redirectUri: string,
  registrationEndpointUrl: URL | undefined,
  approvedOrigins: string[],
  authMethodsSupported: string[] | undefined,
  deps: OauthDiscoveryDeps,
): Promise<{ ok: true; value: ResolvedClient } | { ok: false; reason: string }> {
  if (entry.oauthClientId) {
    if (!entry.oauthClientSecret) {
      return { ok: true, value: { clientId: entry.oauthClientId, tokenEndpointAuthMethod: DEFAULT_AUTH_METHOD } };
    }
    const secret = resolveClientSecret(entry.oauthClientSecret);
    if (!secret.ok) return secret;
    const authMethod = resolvePreconfiguredAuthMethod(authMethodsSupported);
    if (!authMethod.ok) return authMethod;
    return {
      ok: true,
      value: {
        clientId: entry.oauthClientId,
        clientSecret: secret.value,
        tokenEndpointAuthMethod: authMethod.value,
      },
    };
  }

  if (!registrationEndpointUrl) {
    return refuse("authorization server does not support dynamic client registration");
  }

  return registerClient(registrationEndpointUrl.toString(), entry.title, redirectUri, approvedOrigins, deps);
}

function parseMcpUrl(entry: ConnectorEntry): { ok: true; value: URL } | { ok: false; reason: string } {
  if (!entry.url) return refuse("connector has no url configured");
  try {
    return { ok: true, value: new URL(entry.url) };
  } catch {
    return refuse("connector url is not a valid url");
  }
}

export async function resolveOauthConfig(
  entry: ConnectorEntry,
  redirectUri: string,
  deps: OauthDiscoveryDeps = {},
): Promise<OauthConfigResult> {
  const mcpUrl = parseMcpUrl(entry);
  if (!mcpUrl.ok) return mcpUrl;

  const metadata = await resolveAuthorizationServerMetadata(entry, mcpUrl.value, deps);
  if (!metadata.ok) return metadata;
  const m = metadata.value;

  const client = await resolveClient(
    entry,
    redirectUri,
    m.registrationEndpointUrl,
    entry.authOrigins ?? [],
    m.authMethodsSupported,
    deps,
  );
  if (!client.ok) return client;

  const fingerprint = computeOauthFingerprint({
    mcpUrl: entry.url!,
    issuer: m.issuer.toString(),
    authorizationEndpoint: m.authorizationEndpoint.toString(),
    tokenEndpoint: m.tokenEndpoint.toString(),
    clientId: client.value.clientId,
    scopes: m.scopes,
    resource: m.resource,
  });

  return {
    ok: true,
    config: {
      authorizationEndpoint: m.authorizationEndpoint.toString(),
      tokenEndpoint: m.tokenEndpoint.toString(),
      revocationEndpoint: m.revocationEndpoint?.toString(),
      clientId: client.value.clientId,
      clientSecret: client.value.clientSecret,
      tokenEndpointAuthMethod: client.value.tokenEndpointAuthMethod,
      scopes: m.scopes,
      resource: m.resource,
      fingerprint,
    },
  };
}

export type OauthReverifyResult = { ok: true; config: OauthConfig } | { ok: false; reason: string };

export async function reverifyOauthConfig(
  entry: ConnectorEntry,
  storedClient: OauthConfig,
  expectedFingerprint: string,
  deps: OauthDiscoveryDeps = {},
): Promise<OauthReverifyResult> {
  const mcpUrl = parseMcpUrl(entry);
  if (!mcpUrl.ok) return mcpUrl;

  const metadata = await resolveAuthorizationServerMetadata(entry, mcpUrl.value, deps);
  if (!metadata.ok) return metadata;
  const m = metadata.value;

  const fingerprint = computeOauthFingerprint({
    mcpUrl: entry.url!,
    issuer: m.issuer.toString(),
    authorizationEndpoint: m.authorizationEndpoint.toString(),
    tokenEndpoint: m.tokenEndpoint.toString(),
    clientId: storedClient.clientId,
    scopes: m.scopes,
    resource: m.resource,
  });

  if (fingerprint !== expectedFingerprint) {
    return refuse("authorization server metadata drifted since connect");
  }

  return {
    ok: true,
    config: {
      authorizationEndpoint: m.authorizationEndpoint.toString(),
      tokenEndpoint: m.tokenEndpoint.toString(),
      revocationEndpoint: m.revocationEndpoint?.toString(),
      clientId: storedClient.clientId,
      clientSecret: storedClient.clientSecret,
      tokenEndpointAuthMethod: storedClient.tokenEndpointAuthMethod,
      scopes: m.scopes,
      resource: m.resource,
      fingerprint,
    },
  };
}
