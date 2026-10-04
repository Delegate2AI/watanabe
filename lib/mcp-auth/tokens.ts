import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";

/**
 * MCP client credentials (spec 2026-08-21-admin-kb-mcp, D2).
 *
 * The plaintext exists exactly once, in the response to the mint that created
 * it. The row holds only `sha256(token)`, and every lookup is BY that hash, so
 * an unknown token and a revoked one take the same path and answer the same
 * way. The token names its owner and nothing else: roles and clearance are
 * resolved live per call, so revoking a role takes the capability away without
 * touching the token.
 */

export interface TokenSummary {
  id: string;
  name: string;
  /**
   * The OAuth client this token was issued to, or null for a portal token an
   * admin minted directly. It is what lets one list show both kinds and say
   * which is which.
   */
  clientId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface TokenRow {
  id: string;
  owner_email: string;
  name: string;
  client_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalized(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mint a credential. `clientId` and `expiresAt` are what separate an OAuth
 * access token from a portal token: a portal token has neither, which is why
 * both are nullable and why every row written before they existed reads
 * correctly as a portal token with no backfill.
 */
export function mintToken(
  db: DatabaseType,
  input: { ownerEmail: string; name: string; clientId?: string; expiresAt?: string },
  now: string = new Date().toISOString(),
): { id: string; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO mcp_tokens (id, owner_email, name, token_hash, created_at, client_id, expires_at)
     VALUES (@id, @owner, @name, @hash, @now, @client, @expires)`,
  ).run({
    id,
    owner: normalized(input.ownerEmail),
    name: input.name.trim(),
    hash: hash(token),
    now,
    client: input.clientId ?? null,
    expires: input.expiresAt ?? null,
  });
  return { id, token };
}

/**
 * The token's owner, or `null`. Read-only on purpose: a refused credential and
 * an accepted one do exactly one SELECT and no write, so the two are not
 * separable by how long the refusal took. The caller stamps with `touchToken`
 * once it has decided to accept.
 */
export function resolveToken(
  db: DatabaseType,
  token: string,
  now: string = new Date().toISOString(),
): { id: string; ownerEmail: string } | null {
  const candidate = token.trim();
  if (!candidate) return null;
  const row = db
    .prepare(
      `SELECT id, owner_email FROM mcp_tokens
       WHERE token_hash = @hash
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > @now)`,
    )
    .get({ hash: hash(candidate), now }) as { id: string; owner_email: string } | undefined;
  return row ? { id: row.id, ownerEmail: row.owner_email } : null;
}

/** Record that an accepted token was used, so an unused one reads as unused. */
export function touchToken(db: DatabaseType, id: string, now: string = new Date().toISOString()): void {
  db.prepare(`UPDATE mcp_tokens SET last_used_at = @now WHERE id = @id`).run({ now, id });
}

/** One owner's tokens, revoked ones included so a revocation is visible. */
export function listTokens(db: DatabaseType, ownerEmail: string): TokenSummary[] {
  const rows = db
    .prepare(
      `SELECT id, owner_email, name, client_id, created_at, last_used_at, revoked_at
       FROM mcp_tokens WHERE owner_email = @owner ORDER BY created_at DESC, id`,
    )
    .all({ owner: normalized(ownerEmail) }) as TokenRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Revoke one of the caller's OWN tokens. Owner-scoped, so one admin cannot
 * revoke another's. Idempotent: revoking an already-revoked token reports true.
 */
export function revokeToken(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  now: string = new Date().toISOString(),
): boolean {
  const row = db
    .prepare(`SELECT id FROM mcp_tokens WHERE id = @id AND owner_email = @owner`)
    .get({ id, owner: normalized(ownerEmail) }) as { id: string } | undefined;
  if (!row) return false;
  db.prepare(`UPDATE mcp_tokens SET revoked_at = COALESCE(revoked_at, @now) WHERE id = @id`).run({ now, id });
  return true;
}
