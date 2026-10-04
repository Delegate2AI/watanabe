import type { Database as DatabaseType } from "better-sqlite3";
import { evictSessionsForOwner } from "@/lib/agent/session-evict-all";
import { getSession } from "@/lib/agent/session";
import { getDb } from "@/lib/db/client";
import { getCredential, updateCredentialIfUnchanged, type ConnectorCredential } from "@/lib/db/connector-credentials";
import { listThreadConnectors } from "@/lib/db/thread-connectors";
import { log } from "@/lib/log";
import { openCredential, sealCredential } from "./cred-crypto";
import { isConnectorOauthEnabled } from "./config";
import { parseSealedCredential, refreshAccessToken, type SealedOauthCredential } from "./oauth-exchange";
import { loadConnectorRegistry } from "./registry";
import type { ConnectorEntry, OauthBearer } from "./types";

const REFRESH_WINDOW_MS = 120_000;

const inflightRefreshes = new Map<string, Promise<string | null>>();

function inflightKey(callerEmail: string, slug: string): string {
  return `${callerEmail} ${slug}`;
}

function allowedEndpointOrigins(entry: ConnectorEntry): string[] {
  const origins = [...(entry.authOrigins ?? [])];
  if (entry.url) {
    try {
      origins.push(new URL(entry.url).origin);
    } catch {
      // silent-ok
    }
  }
  return origins;
}

function originAllowed(urlString: string, allowed: string[]): boolean {
  try {
    return allowed.includes(new URL(urlString).origin);
  } catch {
    return false;
  }
}

function isClientModeMismatch(entry: ConnectorEntry, credential: SealedOauthCredential): boolean {
  if (!credential.clientSource) return true;
  if (entry.oauthClientId) {
    return credential.clientSource !== "preconfigured" || entry.oauthClientId !== credential.clientId;
  }
  return credential.clientSource !== "dcr";
}

function isRegistryMismatch(entry: ConnectorEntry | undefined, credential: SealedOauthCredential): boolean {
  if (!entry || entry.auth !== "oauth" || !entry.url) return true;
  if (!credential.mcpUrl || credential.mcpUrl !== entry.url) return true;
  if (isClientModeMismatch(entry, credential)) return true;
  const allowed = allowedEndpointOrigins(entry);
  if (!originAllowed(credential.tokenEndpoint, allowed)) return true;
  if (credential.revocationEndpoint && !originAllowed(credential.revocationEndpoint, allowed)) return true;
  return false;
}

function isExpiringSoon(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const parsedMs = Date.parse(expiresAt);
  if (Number.isNaN(parsedMs)) return false;
  return parsedMs - Date.now() <= REFRESH_WINDOW_MS;
}

async function performRefresh(
  db: DatabaseType,
  callerEmail: string,
  slug: string,
  row: ConnectorCredential,
  parsed: SealedOauthCredential,
): Promise<string | null> {
  if (!parsed.refreshToken) return null;

  const result = await refreshAccessToken(
    {
      tokenEndpoint: parsed.tokenEndpoint,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      tokenEndpointAuthMethod: parsed.tokenEndpointAuthMethod,
      resource: parsed.resource,
    },
    parsed.refreshToken,
  );
  if (!result.ok) return null;

  const updated: SealedOauthCredential = {
    ...parsed,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken ?? parsed.refreshToken,
    expiresAt: result.tokens.expiresAt,
  };
  const sealed = sealCredential(updated, { email: callerEmail, slug, fingerprint: row.fingerprint });
  if (!sealed) return null;

  const written = updateCredentialIfUnchanged(db, {
    callerEmail,
    slug,
    expectedCiphertext: row.ciphertext,
    fingerprint: row.fingerprint,
    ciphertext: sealed.ciphertext,
    keyId: sealed.keyId,
    expiresAt: updated.expiresAt ?? null,
    updatedAt: new Date().toISOString(),
  });
  if (!written) return null;

  return updated.accessToken;
}

function refreshOnce(
  db: DatabaseType,
  callerEmail: string,
  slug: string,
  row: ConnectorCredential,
  parsed: SealedOauthCredential,
): Promise<string | null> {
  const key = inflightKey(callerEmail, slug);
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const promise = performRefresh(db, callerEmail, slug, row, parsed).finally(() => {
    inflightRefreshes.delete(key);
  });
  inflightRefreshes.set(key, promise);
  return promise;
}

async function resolveOneBearer(
  db: DatabaseType,
  callerEmail: string,
  slug: string,
  entry: ConnectorEntry | undefined,
): Promise<OauthBearer | null> {
  const row = getCredential(db, callerEmail, slug);
  if (!row) return null;

  const opened = openCredential(row.ciphertext, row.keyId, { email: callerEmail, slug, fingerprint: row.fingerprint });
  const parsed = opened ? parseSealedCredential(opened) : null;
  if (!parsed) return null;

  if (isRegistryMismatch(entry, parsed)) {
    try {
      evictSessionsForOwner(callerEmail);
    } catch (error) {
      log.warn("connector oauth eviction on mismatch failed", { slug, callerEmail, err: String(error) });
    }
    return null;
  }

  const url = entry!.url!;
  if (!isExpiringSoon(parsed.expiresAt)) return { token: parsed.accessToken, url };
  const refreshed = await refreshOnce(db, callerEmail, slug, row, parsed);
  return refreshed ? { token: refreshed, url } : null;
}

function bearerStillCurrent(
  db: DatabaseType,
  callerEmail: string,
  slug: string,
  bearer: OauthBearer,
): boolean {
  try {
    const row = getCredential(db, callerEmail, slug);
    if (!row) return false;
    const opened = openCredential(row.ciphertext, row.keyId, { email: callerEmail, slug, fingerprint: row.fingerprint });
    const parsed = opened ? parseSealedCredential(opened) : null;
    return parsed?.accessToken === bearer.token;
  } catch (error) {
    log.warn("connector oauth bearer recheck failed", { slug, callerEmail, err: String(error) });
    return false;
  }
}

export async function resolveOauthBearer(
  db: DatabaseType,
  callerEmail: string,
  slugs: readonly string[],
): Promise<Map<string, OauthBearer>> {
  const result = new Map<string, OauthBearer>();
  if (!isConnectorOauthEnabled() || slugs.length === 0) return result;

  let entryBySlug: Map<string, ConnectorEntry>;
  try {
    entryBySlug = new Map(loadConnectorRegistry().entries.map((entry) => [entry.slug, entry]));
  } catch {
    return result;
  }

  for (const slug of new Set(slugs)) {
    try {
      const bearer = await resolveOneBearer(db, callerEmail, slug, entryBySlug.get(slug));
      if (bearer) result.set(slug, bearer);
    } catch (error) {
      log.warn("connector oauth bearer resolution failed", { slug, callerEmail, err: String(error) });
    }
  }

  for (const [slug, bearer] of result) {
    if (!bearerStillCurrent(db, callerEmail, slug, bearer)) result.delete(slug);
  }

  return result;
}

function safeListThreadConnectors(db: DatabaseType, threadId: string): string[] {
  try {
    return listThreadConnectors(db, threadId);
  } catch {
    return [];
  }
}

function hasWarmResumableSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  const existing = getSession(sessionId);
  return Boolean(existing && !existing.isEnded);
}

export async function resolveOauthBearerForRequest(
  callerEmail: string,
  sessionId: string | undefined,
  pendingSlugs: readonly string[] | undefined,
): Promise<Map<string, OauthBearer>> {
  if (!isConnectorOauthEnabled()) return new Map();
  if (hasWarmResumableSession(sessionId)) return new Map();
  const db = getDb();
  const opted = sessionId ? safeListThreadConnectors(db, sessionId) : [];
  return resolveOauthBearer(db, callerEmail, [...new Set([...(pendingSlugs ?? []), ...opted])]);
}
