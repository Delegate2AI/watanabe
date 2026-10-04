import { createHash, randomBytes } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Refresh tokens, rotated on every use (spec 2026-09-05, D3).
 *
 * Stored as a hash like everything else here. Thirty days, and every use mints
 * a successor and retires its predecessor.
 *
 * Rotation is what makes theft detectable. A refresh token is presented exactly
 * once by an honest client, so a second presentation means two parties hold it
 * and there is no way to tell which one is the thief. The whole chain for that
 * client and owner is revoked, the person notices they have been signed out,
 * and they reconnect. Sharing access with a thief silently is the worse
 * outcome.
 */

const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(email: string): string {
  return email.trim().toLowerCase();
}

export function issueRefreshToken(
  db: DatabaseType,
  grant: { clientId: string; ownerEmail: string },
  now: string = new Date().toISOString(),
): { token: string } {
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO oauth_refresh_tokens (token_hash, client_id, owner_email, created_at, expires_at)
     VALUES (@hash, @clientId, @owner, @now, @expires)`,
  ).run({
    hash: hash(token),
    clientId: grant.clientId,
    owner: normalized(grant.ownerEmail),
    now,
    expires: new Date(new Date(now).getTime() + LIFETIME_MS).toISOString(),
  });
  return { token };
}

/** Revoke every live refresh token for one client and person. */
function revokeChain(db: DatabaseType, clientId: string, ownerEmail: string, now: string): void {
  db.prepare(
    `UPDATE oauth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, @now)
     WHERE client_id = @clientId AND owner_email = @owner AND revoked_at IS NULL`,
  ).run({ now, clientId, owner: ownerEmail });
}

/**
 * Spend a refresh token and mint its successor, or refuse.
 *
 * Every refusal returns null: an invented token, an expired one, one belonging
 * to another client, and a superseded one all answer the same way. The
 * superseded case additionally revokes the chain before answering.
 */
export function rotateRefreshToken(
  db: DatabaseType,
  token: string,
  clientId: string,
  now: string = new Date().toISOString(),
): { token: string; ownerEmail: string; clientId: string } | null {
  const candidate = token.trim();
  if (!candidate) return null;

  const row = db
    .prepare(
      `SELECT client_id, owner_email, expires_at, revoked_at, rotated_to
       FROM oauth_refresh_tokens WHERE token_hash = @hash`,
    )
    .get({ hash: hash(candidate) }) as
    | {
        client_id: string;
        owner_email: string;
        expires_at: string;
        revoked_at: string | null;
        rotated_to: string | null;
      }
    | undefined;

  if (!row) return null;
  if (row.client_id !== clientId) return null;

  // Already spent or already revoked. If it was spent, this is a replay of a
  // superseded token and the chain goes with it.
  if (row.rotated_to !== null || row.revoked_at !== null) {
    if (row.rotated_to !== null) revokeChain(db, row.client_id, row.owner_email, now);
    return null;
  }
  if (row.expires_at <= now) return null;

  const next = issueRefreshToken(db, { clientId: row.client_id, ownerEmail: row.owner_email }, now);
  const spent = db
    .prepare(
      `UPDATE oauth_refresh_tokens
       SET rotated_to = @next, revoked_at = @now
       WHERE token_hash = @hash AND rotated_to IS NULL AND revoked_at IS NULL`,
    )
    .run({ next: hash(next.token), now, hash: hash(candidate) });
  // Somebody else rotated it between the read and the write.
  if (spent.changes === 0) return null;

  return { token: next.token, ownerEmail: row.owner_email, clientId: row.client_id };
}

/** Live refresh tokens for one client and person. Exported for the tests that pin chain revocation. */
export function activeRefreshCount(
  db: DatabaseType,
  grant: { clientId: string; ownerEmail: string },
  now: string = new Date().toISOString(),
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM oauth_refresh_tokens
       WHERE client_id = @clientId AND owner_email = @owner
         AND revoked_at IS NULL AND expires_at > @now`,
    )
    .get({ clientId: grant.clientId, owner: normalized(grant.ownerEmail), now }) as { n: number };
  return row.n;
}
