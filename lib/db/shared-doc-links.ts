import type { Database as DatabaseType } from "better-sqlite3";
import type { LinkAccess, DocLink } from "@/lib/shared-docs/types";

/**
 * `doc_links` table access (spec 28), split out of `lib/db/shared-docs.ts` for
 * the file-size limit. External signed links are the only unauthenticated read
 * surface, so their mutations are scoped by `doc_id` (never by token alone): an
 * owner acting on one doc can never touch another doc's links. Re-exported from
 * `lib/db/shared-docs.ts` so callers keep a single import surface.
 */

/** Mint an external signed-link row. Access is view|comment only (DB CHECK). */
export function insertLink(
  db: DatabaseType,
  l: { token: string; docId: string; access: LinkAccess; expiresAt: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO doc_links (token, doc_id, access, expires_at, created_at)
     VALUES (@token, @doc, @access, @expires, @now)`,
  ).run({ token: l.token, doc: l.docId, access: l.access, expires: l.expiresAt, now });
}

/** The link row for `token`, or null. Expiry is enforced by the access layer. */
export function getLink(db: DatabaseType, token: string): DocLink | null {
  const row = db.prepare(`SELECT * FROM doc_links WHERE token = @token`).get({ token }) as
    | { token: string; doc_id: string; access: LinkAccess; expires_at: string | null; created_at: string }
    | undefined;
  return row
    ? { token: row.token, docId: row.doc_id, access: row.access, expiresAt: row.expires_at, createdAt: row.created_at }
    : null;
}

/** Every link on a doc. */
export function listLinks(db: DatabaseType, docId: string): DocLink[] {
  const rows = db
    .prepare(`SELECT * FROM doc_links WHERE doc_id = @doc ORDER BY created_at ASC`)
    .all({ doc: docId }) as Array<{
    token: string;
    doc_id: string;
    access: LinkAccess;
    expires_at: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    token: r.token,
    docId: r.doc_id,
    access: r.access,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }));
}

/**
 * Revoke a link, scoped to BOTH the owning `docId` AND the `token`. Scoping by
 * doc id is the fix for cross-document revocation: an owner acting on doc A can
 * never delete doc B's link even if they present B's token. Returns false when
 * no row matched (unknown token, or a token that belongs to another doc).
 */
export function removeLink(db: DatabaseType, docId: string, token: string): boolean {
  const info = db.prepare(`DELETE FROM doc_links WHERE doc_id = @doc AND token = @token`).run({ doc: docId, token });
  return info.changes > 0;
}
