import type { Database as DatabaseType } from "better-sqlite3";

export interface ConnectorCredential {
  callerEmail: string;
  slug: string;
  fingerprint: string;
  ciphertext: string;
  keyId: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function upsertCredential(
  db: DatabaseType,
  {
    callerEmail,
    slug,
    fingerprint,
    ciphertext,
    keyId,
    expiresAt,
    createdAt,
    updatedAt,
  }: ConnectorCredential,
): void {
  db.prepare(
    `INSERT INTO connector_credentials (caller_email, connector_slug, fingerprint, ciphertext, key_id, expires_at, created_at, updated_at)
     VALUES (@callerEmail, @slug, @fingerprint, @ciphertext, @keyId, @expiresAt, @createdAt, @updatedAt)
     ON CONFLICT (caller_email, connector_slug) DO UPDATE SET
       fingerprint = excluded.fingerprint,
       ciphertext = excluded.ciphertext,
       key_id = excluded.key_id,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
  ).run({
    callerEmail,
    slug,
    fingerprint,
    ciphertext,
    keyId,
    expiresAt,
    createdAt,
    updatedAt,
  });
}

export function updateCredentialIfUnchanged(
  db: DatabaseType,
  {
    callerEmail,
    slug,
    expectedCiphertext,
    fingerprint,
    ciphertext,
    keyId,
    expiresAt,
    updatedAt,
  }: {
    callerEmail: string;
    slug: string;
    expectedCiphertext: string;
    fingerprint: string;
    ciphertext: string;
    keyId: string;
    expiresAt: string | null;
    updatedAt: string;
  },
): boolean {
  const info = db
    .prepare(
      `UPDATE connector_credentials
       SET fingerprint = @fingerprint, ciphertext = @ciphertext, key_id = @keyId, expires_at = @expiresAt, updated_at = @updatedAt
       WHERE caller_email = @callerEmail AND connector_slug = @slug AND ciphertext = @expectedCiphertext`,
    )
    .run({ callerEmail, slug, expectedCiphertext, fingerprint, ciphertext, keyId, expiresAt, updatedAt });

  return info.changes > 0;
}

export function getCredential(
  db: DatabaseType,
  callerEmail: string,
  slug: string,
): ConnectorCredential | null {
  const row = db
    .prepare(
      `SELECT caller_email, connector_slug, fingerprint, ciphertext, key_id, expires_at, created_at, updated_at
       FROM connector_credentials
       WHERE caller_email = @callerEmail AND connector_slug = @slug`,
    )
    .get({ callerEmail, slug }) as {
    caller_email: string;
    connector_slug: string;
    fingerprint: string;
    ciphertext: string;
    key_id: string;
    expires_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    callerEmail: row.caller_email,
    slug: row.connector_slug,
    fingerprint: row.fingerprint,
    ciphertext: row.ciphertext,
    keyId: row.key_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function deleteCredential(db: DatabaseType, callerEmail: string, slug: string): boolean {
  const info = db
    .prepare(`DELETE FROM connector_credentials WHERE caller_email = @callerEmail AND connector_slug = @slug`)
    .run({ callerEmail, slug });

  return info.changes > 0;
}

export function listCredentialSlugs(db: DatabaseType, callerEmail: string): string[] {
  const rows = db
    .prepare(`SELECT connector_slug FROM connector_credentials WHERE caller_email = @callerEmail ORDER BY connector_slug`)
    .all({ callerEmail }) as Array<{ connector_slug: string }>;

  return rows.map((r) => r.connector_slug);
}

export function listCredentialOwners(db: DatabaseType, slug: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT caller_email FROM connector_credentials WHERE connector_slug = @slug ORDER BY caller_email`)
    .all({ slug }) as Array<{ caller_email: string }>;

  return rows.map((r) => r.caller_email);
}

export function deleteCredentialsForSlug(db: DatabaseType, slug: string): number {
  const info = db.prepare(`DELETE FROM connector_credentials WHERE connector_slug = @slug`).run({ slug });
  return info.changes;
}
