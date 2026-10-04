import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * OAuth credential handling for the Circleback MCP server, reading the store
 * the Claude Code CLI writes at `$CLAUDE_CONFIG_DIR/.credentials.json`.
 *
 * Circleback issues access tokens that live 24 hours. It also advertises
 * `refresh_token` in `grant_types_supported`, and the CLI persists a refresh
 * token next to the access token, so renewal needs no human. Before this
 * module existed the poll read only `accessToken` and started failing with
 * HTTP 401 exactly one day after each login.
 */

export interface CirclebackCredentials {
  serverUrl: string;
  accessToken: string;
  refreshToken: string | null;
  clientId: string | null;
  expiresAt: number | null;
  /** Key of the entry inside `mcpOAuth`, so a renewal updates the right one. */
  entryKey: string;
  filePath: string;
}

interface StoredEntry {
  serverName?: string;
  serverUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  expiresAt?: number;
}

interface StoredCredentials {
  mcpOAuth?: Record<string, StoredEntry>;
}

function resolveCredentialsPath(credentialsPath?: string): string {
  if (credentialsPath) return credentialsPath;
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude");
  return path.join(configDir, ".credentials.json");
}

/** Reads the CLI-managed credentials store. Never throws: null when absent. */
export function circlebackCredentials(credentialsPath?: string): CirclebackCredentials | null {
  const filePath = resolveCredentialsPath(credentialsPath);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as StoredCredentials;
    for (const [entryKey, entry] of Object.entries(parsed.mcpOAuth ?? {})) {
      const named = entry.serverName === "circleback" || entryKey.startsWith("circleback|");
      if (!named || !entry.serverUrl || !entry.accessToken) continue;
      return {
        serverUrl: entry.serverUrl,
        accessToken: entry.accessToken,
        refreshToken: entry.refreshToken ?? null,
        clientId: entry.clientId ?? null,
        expiresAt: typeof entry.expiresAt === "number" ? entry.expiresAt : null,
        entryKey,
        filePath,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Renew a minute early so a token cannot lapse between the check and the call. */
const EXPIRY_SKEW_MS = 60_000;

export function credentialsExpired(credentials: CirclebackCredentials, now: number = Date.now()): boolean {
  if (credentials.expiresAt === null) return false;
  return credentials.expiresAt - EXPIRY_SKEW_MS <= now;
}

/** RFC 8414 discovery, so the token endpoint is never hardcoded per vendor. */
async function discoverTokenEndpoint(serverUrl: string, fetchFn: typeof fetch): Promise<string | null> {
  try {
    const { origin } = new URL(serverUrl);
    const response = await fetchFn(`${origin}/.well-known/oauth-authorization-server`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const metadata = (await response.json()) as { token_endpoint?: string };
    return metadata.token_endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Write the renewed token back, preserving every other field in the store.
 * Never throws: a read-only or contended file still leaves the caller with a
 * working token for this run, and the next run simply refreshes again.
 */
function persist(credentials: CirclebackCredentials): void {
  try {
    const parsed = JSON.parse(readFileSync(credentials.filePath, "utf8")) as StoredCredentials;
    const entry = parsed.mcpOAuth?.[credentials.entryKey];
    if (!entry) return;
    entry.accessToken = credentials.accessToken;
    if (credentials.refreshToken) entry.refreshToken = credentials.refreshToken;
    if (credentials.expiresAt !== null) entry.expiresAt = credentials.expiresAt;
    const temporaryPath = `${credentials.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, credentials.filePath);
  } catch {
    return;
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Exchange the stored refresh token for a fresh access token and persist it.
 * Never throws: null means the caller should surface the original auth failure,
 * which for the meetings poll means falling back to a manual `claude mcp login`.
 */
export async function refreshCirclebackToken(
  credentials: CirclebackCredentials,
  fetchFn: typeof fetch = fetch,
): Promise<CirclebackCredentials | null> {
  if (!credentials.refreshToken || !credentials.clientId) return null;
  const endpoint = await discoverTokenEndpoint(credentials.serverUrl, fetchFn);
  if (!endpoint) return null;

  let payload: TokenResponse;
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
        client_id: credentials.clientId,
      }).toString(),
    });
    if (!response.ok) return null;
    payload = (await response.json()) as TokenResponse;
  } catch {
    return null;
  }
  if (!payload.access_token) return null;

  const refreshed: CirclebackCredentials = {
    ...credentials,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? credentials.refreshToken,
    expiresAt: typeof payload.expires_in === "number" ? Date.now() + payload.expires_in * 1000 : null,
  };
  persist(refreshed);
  return refreshed;
}
