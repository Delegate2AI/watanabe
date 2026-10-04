import type { ConnectorEntry } from "./types";
import {
  authorizationServerMetadataUrl,
  fetchMetadataJson,
  fetchWellKnown,
  parseApprovedHttpsUrl,
  parseAuthorizationServerMetadata,
  parseHttpsUrl,
  parseProtectedResourceMetadata,
  protectedResourceMetadataUrls,
  sameIssuer,
  selectApprovedAuthorizationServer,
  type OauthDiscoveryDeps,
} from "./oauth-discovery-metadata";

export type ResolvedAuthorizationServerMetadata = {
  issuer: URL;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  revocationEndpoint?: URL;
  registrationEndpointUrl?: URL;
  authMethodsSupported?: string[];
  resource: string;
  scopes?: string[];
};

export type ResolvedAuthorizationServerMetadataResult =
  | { ok: true; value: ResolvedAuthorizationServerMetadata }
  | { ok: false; reason: string };

export async function resolveAuthorizationServerMetadata(
  entry: ConnectorEntry,
  mcpUrl: URL,
  deps: OauthDiscoveryDeps,
): Promise<ResolvedAuthorizationServerMetadataResult> {
  const approvedOrigins = entry.authOrigins ?? [];
  const mcpOrigin = mcpUrl.origin;

  const prmResult = await fetchWellKnown(protectedResourceMetadataUrls(mcpUrl), approvedOrigins, deps);
  if (!prmResult.ok) return prmResult;

  const prm = parseProtectedResourceMetadata(prmResult.value, mcpOrigin);
  if (!prm.ok) return prm;

  const issuerPick = selectApprovedAuthorizationServer(prm.value.authorizationServers, mcpOrigin, approvedOrigins);
  if (!issuerPick.ok) return issuerPick;
  const issuerUrl = issuerPick.value;

  const asResult = await fetchMetadataJson(authorizationServerMetadataUrl(issuerUrl), approvedOrigins, deps);
  if (!asResult.ok) return asResult;

  const asMetadata = parseAuthorizationServerMetadata(asResult.value);
  if (!asMetadata.ok) return asMetadata;

  const returnedIssuer = parseHttpsUrl(asMetadata.value.issuer, "authorization server metadata issuer");
  if (!returnedIssuer.ok) return returnedIssuer;
  if (!sameIssuer(issuerUrl, returnedIssuer.value)) {
    return { ok: false, reason: "authorization server metadata issuer does not match the requested issuer" };
  }

  const allowedEndpointOrigins = [mcpOrigin, issuerUrl.origin, ...approvedOrigins];

  const authorizationEndpoint = parseApprovedHttpsUrl(
    asMetadata.value.authorizationEndpoint,
    "authorization endpoint",
    allowedEndpointOrigins,
  );
  if (!authorizationEndpoint.ok) return authorizationEndpoint;

  const tokenEndpoint = parseApprovedHttpsUrl(asMetadata.value.tokenEndpoint, "token endpoint", allowedEndpointOrigins);
  if (!tokenEndpoint.ok) return tokenEndpoint;

  let revocationEndpoint: URL | undefined;
  if (asMetadata.value.revocationEndpoint) {
    const parsed = parseApprovedHttpsUrl(asMetadata.value.revocationEndpoint, "revocation endpoint", allowedEndpointOrigins);
    if (!parsed.ok) return parsed;
    revocationEndpoint = parsed.value;
  }

  let registrationEndpointUrl: URL | undefined;
  if (asMetadata.value.registrationEndpoint) {
    const parsed = parseApprovedHttpsUrl(
      asMetadata.value.registrationEndpoint,
      "registration endpoint",
      allowedEndpointOrigins,
    );
    if (!parsed.ok) return parsed;
    registrationEndpointUrl = parsed.value;
  }

  return {
    ok: true,
    value: {
      issuer: issuerUrl,
      authorizationEndpoint: authorizationEndpoint.value,
      tokenEndpoint: tokenEndpoint.value,
      revocationEndpoint,
      registrationEndpointUrl,
      authMethodsSupported: asMetadata.value.tokenEndpointAuthMethodsSupported,
      resource: prm.value.resource ?? mcpUrl.toString(),
      scopes: prm.value.scopes,
    },
  };
}
