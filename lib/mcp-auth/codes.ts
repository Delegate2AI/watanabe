import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Authorization codes (spec 2026-09-05, D3).
 *
 * A code is stored only as its `sha256`, exactly as a token is, so the table
 * cannot be read back into working credentials. It is single use, enforced by
 * the primary key plus `used_at`, and it lives sixty seconds, because all it has
 * to survive is one browser redirect.
 *
 * Every refusal is the same answer. An invented code, a spent one, an expired
 * one, a wrong verifier, a mismatched client and a mismatched redirect all
 * return null, so the difference cannot be used to learn anything about a code
 * the caller does not hold.
 */

const LIFETIME_MS = 60_000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** S256 only. `plain` is not implemented, so a challenge equal to its verifier never matches. */
function verifierMatches(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  // Length has to match before timingSafeEqual, which throws otherwise.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueCode(
  db: DatabaseType,
  grant: { clientId: string; ownerEmail: string; redirectUri: string; codeChallenge: string },
  now: string = new Date().toISOString(),
): { code: string } {
  const code = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, owner_email, redirect_uri, code_challenge, created_at, expires_at)
     VALUES (@hash, @clientId, @owner, @redirectUri, @challenge, @now, @expires)`,
  ).run({
    hash: hash(code),
    clientId: grant.clientId,
    owner: grant.ownerEmail.trim().toLowerCase(),
    redirectUri: grant.redirectUri,
    challenge: grant.codeChallenge,
    now,
    expires: new Date(new Date(now).getTime() + LIFETIME_MS).toISOString(),
  });
  return { code };
}

/**
 * Spend a code, or refuse. Marks the row used before returning, so two
 * simultaneous exchanges cannot both succeed.
 */
export function consumeCode(
  db: DatabaseType,
  code: string,
  exchange: { clientId: string; redirectUri: string; codeVerifier: string },
  now: string = new Date().toISOString(),
): { ownerEmail: string; clientId: string } | null {
  const candidate = code.trim();
  if (!candidate) return null;

  const row = db
    .prepare(
      `SELECT client_id, owner_email, redirect_uri, code_challenge, expires_at, used_at
       FROM oauth_codes WHERE code_hash = @hash`,
    )
    .get({ hash: hash(candidate) }) as
    | {
        client_id: string;
        owner_email: string;
        redirect_uri: string;
        code_challenge: string;
        expires_at: string;
        used_at: string | null;
      }
    | undefined;

  if (!row) return null;
  if (row.used_at !== null) return null;
  if (row.expires_at <= now) return null;
  if (row.client_id !== exchange.clientId) return null;
  if (row.redirect_uri !== exchange.redirectUri) return null;
  if (!verifierMatches(exchange.codeVerifier, row.code_challenge)) return null;

  const spent = db
    .prepare(`UPDATE oauth_codes SET used_at = @now WHERE code_hash = @hash AND used_at IS NULL`)
    .run({ now, hash: hash(candidate) });
  // Somebody else spent it between the read and the write.
  if (spent.changes === 0) return null;

  return { ownerEmail: row.owner_email, clientId: row.client_id };
}

/** Drop codes nobody will spend. Called opportunistically; never throws on an empty table. */
export function pruneExpiredCodes(db: DatabaseType, now: string = new Date().toISOString()): void {
  db.prepare(`DELETE FROM oauth_codes WHERE expires_at <= @now`).run({ now });
}
