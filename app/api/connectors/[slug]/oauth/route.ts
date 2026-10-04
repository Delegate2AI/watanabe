import { requireIdentity } from "@/lib/auth/identity";
import { evictSessionsForOwner } from "@/lib/agent/session-evict-all";
import { isConnectorsEnabled, isConnectorOauthEnabled } from "@/lib/connectors/config";
import { findClearedConnectorEntry } from "@/lib/connectors/clearance";
import { resolveOauthConfig } from "@/lib/connectors/oauth-discovery";
import { sealOauthConfigSnapshot } from "@/lib/connectors/oauth-config-snapshot";
import { generatePkce } from "@/lib/auth/oidc/authorize";
import { createState, pruneStates } from "@/lib/db/connector-oauth-states";
import { getCredential, deleteCredential } from "@/lib/db/connector-credentials";
import { getDb } from "@/lib/db/client";
import { canSealCredentials, openCredential } from "@/lib/connectors/cred-crypto";
import { parseSealedCredential, resolveConnectorRedirectUri, revokeCredentialTokens } from "@/lib/connectors/oauth-exchange";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_TTL_MS = 10 * 60 * 1000;
const ROUTE = "/api/connectors/[slug]/oauth";

function flagsOff(): boolean {
  return !isConnectorOauthEnabled() || !isConnectorsEnabled();
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (flagsOff()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  const { slug } = await params;
  const db = getDb();

  try {
    pruneStates(db, new Date().toISOString());
    const entry = findClearedConnectorEntry(slug, identity.email);
    if (!entry) return fail("not_found");
    if (entry.auth !== "oauth") return fail("invalid_request", { detail: "auth" });

    if (!canSealCredentials()) {
      log.error("connector oauth connect refused: credential sealing unavailable", { route: `POST ${ROUTE}`, slug });
      return fail("internal", { status: 503 });
    }

    const redirectUri = resolveConnectorRedirectUri();
    if (!redirectUri.ok) {
      log.error("connector oauth connect failed", { route: `POST ${ROUTE}`, slug, reason: redirectUri.reason });
      return fail("internal");
    }

    const config = await resolveOauthConfig(entry, redirectUri.value);
    if (!config.ok) {
      log.warn("connector oauth discovery failed", { route: `POST ${ROUTE}`, slug, reason: config.reason });
      return fail("internal");
    }

    const configSnapshot = sealOauthConfigSnapshot(entry, config.config, {
      email: identity.email,
      slug,
      fingerprint: config.config.fingerprint,
    });
    if (!configSnapshot) {
      log.error("connector oauth connect failed to seal the config snapshot", { route: `POST ${ROUTE}`, slug });
      return fail("internal");
    }

    const { verifier, challenge } = generatePkce();
    const now = new Date();
    const state = createState(db, {
      callerEmail: identity.email,
      connectorSlug: slug,
      verifier,
      fingerprint: config.config.fingerprint,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
      configSnapshot,
    });

    const authorizationUrl = new URL(config.config.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", config.config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri.value);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("resource", config.config.resource);
    if (config.config.scopes && config.config.scopes.length > 0) {
      authorizationUrl.searchParams.set("scope", config.config.scopes.join(" "));
    }

    return Response.json({ redirect: authorizationUrl.toString() });
  } catch (e) {
    log.error("connector oauth connect failed", {
      route: `POST ${ROUTE}`,
      slug,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (flagsOff()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;
  const { slug } = await params;

  try {
    const entry = findClearedConnectorEntry(slug, identity.email);
    if (!entry) return fail("not_found");

    const db = getDb();
    const credential = getCredential(db, identity.email, slug);
    if (credential) {
      const opened = openCredential(credential.ciphertext, credential.keyId, {
        email: identity.email,
        slug,
        fingerprint: credential.fingerprint,
      });
      const parsed = opened ? parseSealedCredential(opened) : null;
      if (parsed) {
        try {
          await revokeCredentialTokens(parsed);
        } catch (e) {
          log.warn("connector oauth revocation failed", { route: `DELETE ${ROUTE}`, slug, err: String(e) });
        }
      }
      deleteCredential(db, identity.email, slug);
      evictSessionsForOwner(identity.email);
    }

    return Response.json({ disconnected: true });
  } catch (e) {
    log.error("connector oauth disconnect failed", {
      route: `DELETE ${ROUTE}`,
      slug,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
