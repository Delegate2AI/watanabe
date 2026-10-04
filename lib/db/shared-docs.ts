import type { Database as DatabaseType } from "better-sqlite3";
import { insertVersion, listVersions, nextVersion } from "@/lib/documents/version-store";
import { fromRow, type DocRow } from "./shared-doc-rows";

/**
 * `shared_docs` + children table access (spec 28): the store for titled,
 * versioned markdown documents a user shares sideways to specific people (and,
 * since migration v26, to whole teams) via an explicit ACL. Mirrors
 * `lib/db/artifacts.ts`'s shape (pure, DB-instance-agnostic functions, directly
 * unit-testable against `:memory:`).
 *
 * This module is deliberately ACL-agnostic: it exposes raw records and share/
 * link lookups. Authorization (owner OR `doc_shares` row OR valid `doc_links`
 * token, highest wins, deny = 404 no oracle) is composed one layer up in
 * `lib/shared-docs/access.ts`, so the enforcement seam is single and testable.
 *
 * Every statement uses named placeholders with object bindings (repo DB
 * convention); child mutations are scoped by `doc_id` so a token/recipient key
 * alone can never reach across documents.
 *
 * The `doc_shares` row CRUD lives in `./shared-doc-shares.ts` and the external
 * signed-link CRUD in `./shared-doc-links.ts` (both file-size splits); both are
 * re-exported below so callers keep one import surface for the store.
 */

import type {
  SharedDocRecord,
  DocVersion,
  DocComment,
  SharedVersionOptions,
} from "@/lib/shared-docs/types";
import { DEFAULT_DOC_FORMAT, type DocFormat } from "@/lib/documents/types";

const SHARED_DOC_VERSION_STORE = {
  table: "shared_doc_versions",
  fkColumn: "doc_id",
  extraColumns: ["author_email", "format"],
} as const;

const SHARED_DOC_VERSION_COLUMNS = ["version", "body", "format", "author_email", "created_at"] as const;

export type {
  SharedAccess,
  LinkAccess,
  SharedDocRecord,
  DocVersion,
  DocShare,
  ShareRecipientKind,
  DocComment,
  DocLink,
} from "@/lib/shared-docs/types";

// `doc_shares` row CRUD, split to its own file (see the module docblock).
export {
  sharesForPrincipal,
  listSharedWith,
  getShare,
  listShares,
  upsertShare,
  removeShare,
} from "./shared-doc-shares";

/** Create a shared doc and seed its version 1 from `body`, in one transaction. */
export function insertSharedDoc(
  db: DatabaseType,
  d: { id: string; title: string; ownerEmail: string; body: string; format?: DocFormat },
  now: string = new Date().toISOString(),
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
       VALUES (@id, @title, @owner, @now, @now)`,
    ).run({ id: d.id, title: d.title, owner: d.ownerEmail, now });
    insertVersion(db, SHARED_DOC_VERSION_STORE, {
      id: d.id,
      version: 1,
      body: d.body,
      createdAt: now,
      extra: { author_email: d.ownerEmail, format: d.format ?? DEFAULT_DOC_FORMAT },
    });
  })();
}

/** The doc row (unscoped). Access is resolved by `lib/shared-docs/access.ts`. */
export function getSharedDoc(db: DatabaseType, id: string): SharedDocRecord | null {
  const row = db.prepare(`SELECT * FROM shared_docs WHERE id = @id`).get({ id }) as DocRow | undefined;
  return row ? fromRow(row) : null;
}

/** Docs owned by `ownerEmail`, newest activity first. */
export function listSharedByOwner(db: DatabaseType, ownerEmail: string): SharedDocRecord[] {
  const rows = db
    .prepare(`SELECT * FROM shared_docs WHERE owner_email = @owner ORDER BY updated_at DESC`)
    .all({ owner: ownerEmail }) as DocRow[];
  return rows.map(fromRow);
}

/**
 * The latest version's body AND what that body is.
 *
 * The publish path needs both: an HTML body written into `docs/*.md` verbatim is
 * model-authored markup landing in the vault as if it were prose. Mirrors
 * `latestVersionOf` on the artifacts store.
 */
export function latestVersionOf(
  db: DatabaseType,
  docId: string,
): { body: string; format: DocFormat } | null {
  const row = db
    .prepare(`SELECT body, format FROM shared_doc_versions WHERE doc_id = @doc ORDER BY version DESC LIMIT 1`)
    .get({ doc: docId }) as { body: string; format: DocFormat } | undefined;
  return row ? { body: row.body, format: row.format } : null;
}

/** The latest version body, or null if the doc has no versions/does not exist. */
export function latestBody(db: DatabaseType, docId: string): string | null {
  const row = db
    .prepare(`SELECT body FROM shared_doc_versions WHERE doc_id = @doc ORDER BY version DESC LIMIT 1`)
    .get({ doc: docId }) as { body: string } | undefined;
  return row?.body ?? null;
}

/** Every version, oldest first. Owner-only disclosure: carries author emails. */
export function getVersions(db: DatabaseType, docId: string): DocVersion[] {
  const rows = listVersions<{
    version: number;
    body: string;
    format: DocFormat;
    author_email: string;
    created_at: string;
  }>(db, SHARED_DOC_VERSION_STORE, docId, SHARED_DOC_VERSION_COLUMNS);
  return rows.map((r) => ({
    version: r.version,
    body: r.body,
    format: r.format,
    authorEmail: r.author_email,
    createdAt: r.created_at,
  }));
}

/**
 * Append a new version authored by `authorEmail` (last-writer-wins). Returns the
 * new version number, or `false` if the doc does not exist. Bumps `updated_at`.
 * Authorization (is the author allowed to edit?) is the caller's job.
 */
export function addVersion(
  db: DatabaseType,
  docId: string,
  authorEmail: string,
  body: string,
  options: SharedVersionOptions = {},
): number | false {
  const format = options.format ?? DEFAULT_DOC_FORMAT;
  const now = options.now ?? new Date().toISOString();
  return db.transaction(() => {
    const exists = db.prepare(`SELECT 1 FROM shared_docs WHERE id = @doc`).get({ doc: docId });
    if (!exists) return false;
    const next = nextVersion(db, SHARED_DOC_VERSION_STORE, docId);
    insertVersion(db, SHARED_DOC_VERSION_STORE, {
      id: docId,
      version: next,
      body,
      createdAt: now,
      extra: { author_email: authorEmail, format },
    });
    db.prepare(`UPDATE shared_docs SET updated_at = @now WHERE id = @id`).run({ id: docId, now });
    return next;
  })();
}

/** Rename a doc (owner-scoped). Returns false for an unknown or foreign id. */
export function renameSharedDoc(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  title: string,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(`UPDATE shared_docs SET title = @title, updated_at = @now WHERE id = @id AND owner_email = @owner`)
    .run({ id, owner: ownerEmail, title, now });
  return info.changes > 0;
}

/** Add a comment (for comment/edit access). Authorization is the caller's job. */
export function addComment(
  db: DatabaseType,
  c: { id: string; docId: string; authorEmail: string; body: string; anchor: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO doc_comments (id, doc_id, author_email, body, anchor, created_at)
     VALUES (@id, @doc, @author, @body, @anchor, @now)`,
  ).run({ id: c.id, doc: c.docId, author: c.authorEmail, body: c.body, anchor: c.anchor, now });
}

/** Every comment on a doc, oldest first. */
export function listComments(db: DatabaseType, docId: string): DocComment[] {
  const rows = db
    .prepare(
      `SELECT id, author_email, body, anchor, created_at
       FROM doc_comments WHERE doc_id = @doc ORDER BY created_at ASC, id ASC`,
    )
    .all({ doc: docId }) as Array<{
    id: string;
    author_email: string;
    body: string;
    anchor: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    authorEmail: r.author_email,
    body: r.body,
    anchor: r.anchor,
    createdAt: r.created_at,
  }));
}

// External signed-link CRUD lives in `./shared-doc-links.ts` (file-size split);
// re-exported here so callers keep one import surface for the shared-docs store.
export { insertLink, getLink, listLinks, removeLink } from "./shared-doc-links";

/**
 * Delete a doc and all its children (owner-scoped). Returns false for an unknown
 * or foreign id. Children are removed explicitly rather than relying on a cascade
 * pragma the shared connection does not enable -- including the spec
 * 2026-07-22 annotation tables (comment threads + their messages,
 * suggestions), whose schema declares `ON DELETE CASCADE` but which still
 * need this explicit cleanup for the same reason as the older tables below.
 */
export function deleteSharedDoc(db: DatabaseType, id: string, ownerEmail: string): boolean {
  return db.transaction(() => {
    const info = db
      .prepare(`DELETE FROM shared_docs WHERE id = @id AND owner_email = @owner`)
      .run({ id, owner: ownerEmail });
    if (info.changes === 0) return false;
    db.prepare(`DELETE FROM shared_doc_versions WHERE doc_id = @doc`).run({ doc: id });
    db.prepare(`DELETE FROM doc_shares WHERE doc_id = @doc`).run({ doc: id });
    db.prepare(`DELETE FROM doc_comments WHERE doc_id = @doc`).run({ doc: id });
    db.prepare(`DELETE FROM doc_links WHERE doc_id = @doc`).run({ doc: id });
    db.prepare(
      `DELETE FROM doc_comment_messages
       WHERE thread_id IN (SELECT id FROM doc_comment_threads WHERE doc_id = @doc)`,
    ).run({ doc: id });
    db.prepare(`DELETE FROM doc_comment_threads WHERE doc_id = @doc`).run({ doc: id });
    db.prepare(`DELETE FROM doc_suggestions WHERE doc_id = @doc`).run({ doc: id });
    return true;
  })();
}
