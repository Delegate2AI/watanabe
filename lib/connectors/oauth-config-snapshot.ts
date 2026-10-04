import { openCredential, sealCredential } from "./cred-crypto";
import type { OauthConfig } from "./oauth-discovery";
import type { ConnectorEntry } from "./types";

export type OauthConfigSnapshotEntry = {
  url: string;
  auth: string;
  oauthClientId?: string;
  authOrigins?: string[];
};

export type OauthConfigSnapshot = {
  config: OauthConfig;
  entry: OauthConfigSnapshotEntry;
};

export type OauthConfigSnapshotAad = { email: string; slug: string; fingerprint: string };

export function sealOauthConfigSnapshot(
  entry: ConnectorEntry,
  config: OauthConfig,
  aad: OauthConfigSnapshotAad,
): string | null {
  const snapshot: OauthConfigSnapshot = {
    config,
    entry: {
      url: entry.url ?? "",
      auth: entry.auth ?? "",
      oauthClientId: entry.oauthClientId,
      authOrigins: entry.authOrigins,
    },
  };
  const sealed = sealCredential(snapshot, aad);
  return sealed ? sealed.ciphertext : null;
}

function isOauthConfigShape(value: unknown): value is OauthConfig {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.authorizationEndpoint === "string" &&
    typeof record.tokenEndpoint === "string" &&
    typeof record.clientId === "string" &&
    typeof record.tokenEndpointAuthMethod === "string" &&
    typeof record.resource === "string" &&
    typeof record.fingerprint === "string"
  );
}

export function openOauthConfigSnapshot(value: string, aad: OauthConfigSnapshotAad): OauthConfigSnapshot | null {
  const opened = openCredential(value, "v1", aad);
  if (!opened) return null;
  const record = opened as Record<string, unknown>;
  const config = record.config;
  const entry = record.entry;
  if (!isOauthConfigShape(config)) return null;
  if (!entry || typeof entry !== "object") return null;
  const entryRecord = entry as Record<string, unknown>;
  if (typeof entryRecord.url !== "string" || typeof entryRecord.auth !== "string") return null;
  return record as unknown as OauthConfigSnapshot;
}

export function oauthEntryMatchesSnapshot(entry: ConnectorEntry, snapshot: OauthConfigSnapshotEntry): boolean {
  if ((entry.url ?? "") !== snapshot.url) return false;
  if ((entry.auth ?? "") !== snapshot.auth) return false;
  if ((entry.oauthClientId ?? "") !== (snapshot.oauthClientId ?? "")) return false;
  const entryOrigins = JSON.stringify([...(entry.authOrigins ?? [])].sort());
  const snapshotOrigins = JSON.stringify([...(snapshot.authOrigins ?? [])].sort());
  return entryOrigins === snapshotOrigins;
}
