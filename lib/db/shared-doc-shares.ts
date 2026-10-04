import type { Database as DatabaseType } from "better-sqlite3";
import type { SharedAccess, SharedDocRecord, DocShare, ShareRecipientKind } from "@/lib/shared-docs/types";
import { fromRow, type DocRow } from "./shared-doc-rows";

/**
 * `doc_shares` access: the per-document ACL rows, split out of `./shared-docs.ts`
 * when team sharing (migration v26) grew this concern past the file-size limit.
 *
 * A row addresses either ONE PERSON (`recipient_kind = 'user'`, `recipient_email`
 * is their address) or ONE TEAM (`recipient_kind = 'group'`, `recipient_email`
 * holds the `access/groups.yaml` key). The column keeps its old name because the
 * migration is additive; the domain type calls it `recipient`, which is what it
 * has always really been.
 *
 * A group grant resolves LIVE against the reader's clearance, which is the whole
 * point of it: joining the team grants access and leaving it takes access away,
 * with no edit to the document. This module stays ACL-agnostic in the same way
 * its parent does: it returns rows, and `lib/shared-docs/access.ts` decides.
 */

/**
 * The SQL predicate matching every share row that addresses one principal:
 * their own user row, plus a group row for any team they are in. Returns the
 * fragment and the bindings for its group placeholders, since better-sqlite3
 * cannot bind a list to a single named parameter.
 *
 * `groups` is the caller's resolved clearance. Passing `[]` (the default
 * everywhere) reduces this to exactly the pre-team behaviour: user rows only,
 * which is also how the feature reads with its flag off.
 *
 * Exported because the activity feed builds its own `doc_shares` query and MUST
 * decide reachability the same way this module does. Two hand-written copies of
 * this predicate is precisely how a feed row you cannot open gets shipped.
 * `alias` is the table alias in the caller's query; it is a literal from our own
 * source, never anything a request supplies.
 */
export function principalMatch(
  groups: string[],
  alias = "s",
): { sql: string; binds: Record<string, string> } {
  const unique = [...new Set(groups.map((g) => g.trim()).filter((g) => g !== ""))];
  const binds: Record<string, string> = {};
  unique.forEach((group, i) => {
    binds[`g${i}`] = group;
  });
  const userMatch = `(${alias}.recipient_kind = 'user' AND ${alias}.recipient_email = @who)`;
  if (unique.length === 0) return { sql: userMatch, binds };
  const placeholders = unique.map((_, i) => `@g${i}`).join(", ");
  return {
    sql: `(${userMatch} OR (${alias}.recipient_kind = 'group' AND ${alias}.recipient_email IN (${placeholders})))`,
    binds,
  };
}

/** SQL ranking a share row's access, so a group and a user grant can be compared. */
const ACCESS_RANK_SQL = `CASE s.access WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 ELSE 1 END`;
const ACCESS_BY_RANK: Record<number, SharedAccess> = { 1: "view", 2: "comment", 3: "edit" };

/**
 * Every access level granted to one principal on `docId`: their user row plus
 * any group row for a team they are in. Ordering is not meaningful; the caller
 * (`lib/shared-docs/access.ts`) picks the highest, so the rank stays in one place.
 */
export function sharesForPrincipal(
  db: DatabaseType,
  docId: string,
  email: string,
  groups: string[] = [],
): SharedAccess[] {
  const match = principalMatch(groups);
  const rows = db
    .prepare(`SELECT s.access FROM doc_shares s WHERE s.doc_id = @doc AND ${match.sql}`)
    .all({ doc: docId, who: email, ...match.binds }) as Array<{ access: SharedAccess }>;
  return rows.map((r) => r.access);
}

/**
 * Docs shared WITH this principal, by user row or by a team they are in,
 * carrying the highest access any matching grant gives them.
 *
 * Owned docs are excluded explicitly. Before team sharing that was structural
 * (sharing with yourself is refused), but the owner of a doc can perfectly well
 * be a member of a group they shared it with, and their own document must not
 * turn up under "shared with me".
 */
export function listSharedWith(
  db: DatabaseType,
  recipientEmail: string,
  groups: string[] = [],
): Array<SharedDocRecord & { access: SharedAccess }> {
  const match = principalMatch(groups);
  const rows = db
    .prepare(
      `SELECT d.*, MAX(${ACCESS_RANK_SQL}) AS share_rank
       FROM shared_docs d JOIN doc_shares s ON s.doc_id = d.id
       WHERE ${match.sql} AND d.owner_email <> @who
       GROUP BY d.id ORDER BY d.updated_at DESC`,
    )
    .all({ who: recipientEmail, ...match.binds }) as Array<DocRow & { share_rank: number }>;
  return rows.map((r) => ({ ...fromRow(r), access: ACCESS_BY_RANK[r.share_rank] ?? "view" }));
}

/** One recipient's access on a doc, or null if that exact row does not exist. */
export function getShare(
  db: DatabaseType,
  docId: string,
  recipient: string,
  kind: ShareRecipientKind = "user",
): SharedAccess | null {
  const row = db
    .prepare(
      `SELECT access FROM doc_shares
       WHERE doc_id = @doc AND recipient_email = @who AND recipient_kind = @kind`,
    )
    .get({ doc: docId, who: recipient, kind }) as { access: SharedAccess } | undefined;
  return row?.access ?? null;
}

/** Every share row on a doc, teams first so the broadest grants read first. */
export function listShares(db: DatabaseType, docId: string): DocShare[] {
  const rows = db
    .prepare(
      `SELECT recipient_email, recipient_kind, access, created_at
       FROM doc_shares WHERE doc_id = @doc
       ORDER BY recipient_kind ASC, created_at ASC`,
    )
    .all({ doc: docId }) as Array<{
    recipient_email: string;
    recipient_kind: ShareRecipientKind;
    access: SharedAccess;
    created_at: string;
  }>;
  return rows.map((r) => ({
    recipient: r.recipient_email,
    recipientKind: r.recipient_kind,
    access: r.access,
    createdAt: r.created_at,
  }));
}

/**
 * Add or update a recipient's access level.
 *
 * Idempotent on the primary key, which is `(doc_id, recipient_email)` and does
 * NOT include the kind. That is deliberate and safe: a user key is a validated
 * email and a group key is a bare `groups.yaml` name, so one string can never
 * mean both. The conflict clause writes the kind too, so a row can never be left
 * carrying a stale one.
 *
 * `kind` sits AFTER `now`, which reads oddly and is deliberate: `now` is the
 * repo-wide trailing clock-injection parameter and every existing caller already
 * passes it positionally. Slotting `kind` in front of it would silently
 * re-interpret a timestamp as a recipient kind at dozens of call sites. The
 * sibling functions here have no clock, so `kind` is last there naturally.
 */
export function upsertShare(
  db: DatabaseType,
  docId: string,
  recipient: string,
  access: SharedAccess,
  now: string = new Date().toISOString(),
  kind: ShareRecipientKind = "user",
): void {
  db.prepare(
    `INSERT INTO doc_shares (doc_id, recipient_email, recipient_kind, access, created_at)
     VALUES (@doc, @who, @kind, @access, @now)
     ON CONFLICT (doc_id, recipient_email)
       DO UPDATE SET access = @access, recipient_kind = @kind`,
  ).run({ doc: docId, who: recipient, kind, access, now });
}

/** Revoke one share row. Returns false if there was nothing to revoke. */
export function removeShare(
  db: DatabaseType,
  docId: string,
  recipient: string,
  kind: ShareRecipientKind = "user",
): boolean {
  const info = db
    .prepare(
      `DELETE FROM doc_shares
       WHERE doc_id = @doc AND recipient_email = @who AND recipient_kind = @kind`,
    )
    .run({ doc: docId, who: recipient, kind });
  return info.changes > 0;
}
