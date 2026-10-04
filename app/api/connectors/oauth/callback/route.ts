import { requireIdentity } from "@/lib/auth/identity";
import { evictSessionsForOwner } from "@/lib/agent/session-evict-all";
import { isConnectorsEnabled, isConnectorOauthEnabled } from "@/lib/connectors/config";
import { findClearedConnectorEntry } from "@/lib/connectors/clearance";
import { reverifyOauthConfig } from "@/lib/connectors/oauth-discovery";
import { oauthEntryMatchesSnapshot, openOauthConfigSnapshot } from "@/lib/connectors/oauth-config-snapshot";
import { consumeState } from "@/lib/db/connector-oauth-states";
import { upsertCredential } from "@/lib/db/connector-credentials";
import { getDb } from "@/lib/db/client";
import { canSealCredentials, sealCredential } from "@/lib/connectors/cred-crypto";
import { exchangeAuthorizationCode, resolveConnectorRedirectUri } from "@/lib/connectors/oauth-exchange";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "GET /api/connectors/oauth/callback";

function errorRedirect(): Response {
  return new Response(null, { status: 302, headers: { location: "/connectors?error=oauth" } });
}

function connectedRedirect(slug: string): Response {
  return new Response(null, { status: 302, headers: { location: `/connectors?connected=${encodeURIComponent(slug)}` } });
}

export async function GET(request: Request): Promise<Response> {
  if (!isConnectorOauthEnabled() || !isConnectorsEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return errorRedirect();
  const { identity } = auth;

  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return errorRedirect();

  let slug = "";
  try {
    const stateRow = consumeState(getDb(), state);
    if (!stateRow) return errorRedirect();
    slug = stateRow.connectorSlug;

    if (stateRow.callerEmail !== identity.email) {
      log.warn("connector oauth callback caller mismatch", { route: ROUTE, slug });
      return errorRedirect();
    }

    const entry = findClearedConnectorEntry(slug, identity.email);
    if (!entry || entry.auth !== "oauth") {
      log.warn("connector oauth callback refused: unknown, uncleared, or non oauth entry", { route: ROUTE, slug });
      return errorRedirect();
    }

    if (!canSealCredentials()) {
      log.error("connector oauth callback refused: credential sealing unavailable", { route: ROUTE, slug });
      return errorRedirect();
    }

    const snapshot = openOauthConfigSnapshot(stateRow.configSnapshot, {
      email: stateRow.callerEmail,
      slug,
      fingerprint: stateRow.fingerprint,
    });
    if (!snapshot) {
      log.error("connector oauth callback failed to read the sealed config snapshot", { route: ROUTE, slug });
      return errorRedirect();
    }

    if (!oauthEntryMatchesSnapshot(entry, snapshot.entry)) {
      log.warn("connector oauth callback refused registry drift since connect", { route: ROUTE, slug });
      return errorRedirect();
    }

    const reverified = await reverifyOauthConfig(entry, snapshot.config, stateRow.fingerprint);
    if (!reverified.ok) {
      log.warn("connector oauth callback refused authorization server metadata drift", {
        route: ROUTE,
        slug,
        reason: reverified.reason,
      });
      return errorRedirect();
    }

    const config = reverified.config;

    const redirectUri = resolveConnectorRedirectUri();
    if (!redirectUri.ok) {
      log.error("connector oauth callback failed", { route: ROUTE, slug, reason: redirectUri.reason });
      return errorRedirect();
    }

    const exchanged = await exchangeAuthorizationCode(config, {
      code,
      verifier: stateRow.verifier,
      redirectUri: redirectUri.value,
    });
    if (!exchanged.ok) {
      log.warn("connector oauth token exchange failed", { route: ROUTE, slug, reason: exchanged.reason });
      return errorRedirect();
    }

    const sealed = sealCredential(
      {
        accessToken: exchanged.tokens.accessToken,
        refreshToken: exchanged.tokens.refreshToken,
        expiresAt: exchanged.tokens.expiresAt,
        tokenEndpoint: config.tokenEndpoint,
        revocationEndpoint: config.revocationEndpoint,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
        mcpUrl: entry.url,
        resource: config.resource,
        clientSource: entry.oauthClientId ? "preconfigured" : "dcr",
      },
      { email: identity.email, slug, fingerprint: config.fingerprint },
    );
    if (!sealed) {
      log.error("connector oauth callback failed to seal credential", { route: ROUTE, slug });
      return errorRedirect();
    }

    const now = new Date().toISOString();
    upsertCredential(getDb(), {
      callerEmail: identity.email,
      slug,
      fingerprint: config.fingerprint,
      ciphertext: sealed.ciphertext,
      keyId: sealed.keyId,
      expiresAt: exchanged.tokens.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    });

    evictSessionsForOwner(identity.email);

    return connectedRedirect(slug);
  } catch (e) {
    log.error("connector oauth callback failed", { route: ROUTE, slug, owner: identity.email, err: String(e) });
    return errorRedirect();
  }
}
