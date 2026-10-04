import { randomUUID } from "crypto";
import type { Database as DatabaseType } from "better-sqlite3";

export interface OAuthState {
  state: string;
  callerEmail: string;
  connectorSlug: string;
  verifier: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  configSnapshot: string;
}

export function createState(
  db: DatabaseType,
  {
    callerEmail,
    connectorSlug,
    verifier,
    fingerprint,
    createdAt,
    expiresAt,
    configSnapshot,
  }: Omit<OAuthState, "state">,
): string {
  const state = randomUUID();

  db.prepare(
    `DELETE FROM connector_oauth_states
     WHERE caller_email = @callerEmail AND connector_slug = @connectorSlug`,
  ).run({ callerEmail, connectorSlug });

  db.prepare(
    `INSERT INTO connector_oauth_states (state, caller_email, connector_slug, verifier, fingerprint, created_at, expires_at, config_snapshot)
     VALUES (@state, @callerEmail, @connectorSlug, @verifier, @fingerprint, @createdAt, @expiresAt, @configSnapshot)`,
  ).run({
    state,
    callerEmail,
    connectorSlug,
    verifier,
    fingerprint,
    createdAt,
    expiresAt,
    configSnapshot,
  });

  return state;
}

export function consumeState(db: DatabaseType, state: string): OAuthState | null {
  const now = new Date().toISOString();

  const row = db
    .prepare(
      `DELETE FROM connector_oauth_states
       WHERE state = @state AND expires_at > @now
       RETURNING state, caller_email, connector_slug, verifier, fingerprint, created_at, expires_at, config_snapshot`,
    )
    .get({ state, now }) as {
    state: string;
    caller_email: string;
    connector_slug: string;
    verifier: string;
    fingerprint: string;
    created_at: string;
    expires_at: string;
    config_snapshot: string;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    state: row.state,
    callerEmail: row.caller_email,
    connectorSlug: row.connector_slug,
    verifier: row.verifier,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    configSnapshot: row.config_snapshot,
  };
}

export function pruneStates(db: DatabaseType, now: string): void {
  db.prepare(`DELETE FROM connector_oauth_states WHERE expires_at <= @now`).run({ now });
}
