import type { Database as DatabaseType } from "better-sqlite3";
import { insertVersion, nextVersion } from "@/lib/documents/version-store";
import { DEFAULT_DOC_FORMAT, type DocFormat } from "@/lib/documents/types";
import { fromRow, type AddVersionOptions, type ChatDocRecord, type ChatDocPromotion, type ChatDocVersion, type DocRow, type PromotionTarget } from "./chat-docs-types";
import { isOwnedBy } from "./ownership";

const CHAT_DOCUMENT_VERSION_STORE = {
  table: "chat_document_versions",
  fkColumn: "doc_id",
  extraColumns: ["format"],
} as const;

/**
 * `chat_documents` + `chat_document_versions` + `chat_document_promotions`
 * table access (spec 29): the store behind the in-chat documents and canvas
 * pane. A chat document is a titled, versioned markdown document the assistant
 * produced via the `doc_write` tool, bound to one source thread.
 *
 * AUTHORITY IS SOURCE-THREAD OWNERSHIP, not the denormalized
 * `chat_documents.owner_email`. Every read/write joins `chat_documents.thread_id`
 * to the `threads` registry and filters by the thread's `owner_email`, and every
 * mutation is conditional on that same relationship, so the store is fail-closed
 * on its own and never depends on a caller remembering to check. A row whose
 * source thread is foreign OR unknown is indistinguishable from a missing row
 * (null / false / empty here, a 404 at the route: no existence oracle).
 */

export type { PromotionTarget, ChatDocRecord, ChatDocVersion, ChatDocPromotion, AddVersionOptions };

/** True IF `owner` owns the source thread of chat document `id` (the authority). */
function ownsDoc(db: DatabaseType, id: string, owner: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM chat_documents cd JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE cd.id = @id AND t.owner_email = @owner`,
    )
    .get({ id, owner });
  return row !== undefined;
}

/**
 * Create a chat document and seed its version 1, in one transaction. Fail-closed:
 * only creates when `ownerEmail` actually owns `threadId` in the thread registry
 * (an arbitrary owner/thread pair writes nothing). Returns whether it was created.
 */
export function createDoc(
  db: DatabaseType,
  d: {
    id: string;
    threadId: string;
    ownerEmail: string;
    title: string;
    body: string;
    /** Defaults to markdown, so an existing caller keeps writing exactly what it did. */
    format?: DocFormat;
  },
  now: string = new Date().toISOString(),
): boolean {
  return db.transaction(() => {
    if (!isOwnedBy(db, d.threadId, d.ownerEmail)) return false;
    db.prepare(
      `INSERT INTO chat_documents (id, thread_id, owner_email, title, current_version, created_at, updated_at)
       VALUES (@id, @thread, @owner, @title, 1, @now, @now)`,
    ).run({ id: d.id, thread: d.threadId, owner: d.ownerEmail, title: d.title, now });
    insertVersion(db, CHAT_DOCUMENT_VERSION_STORE, {
      id: d.id,
      version: 1,
      body: d.body,
      createdAt: now,
      extra: { format: d.format ?? DEFAULT_DOC_FORMAT },
    });
    return true;
  })();
}

/** The chat document with `id` IF `ownerEmail` owns its source thread, else `null`. */
export function getDocForOwner(db: DatabaseType, id: string, ownerEmail: string): ChatDocRecord | null {
  const row = db
    .prepare(
      `SELECT cd.* FROM chat_documents cd JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE cd.id = @id AND t.owner_email = @owner`,
    )
    .get({ id, owner: ownerEmail }) as DocRow | undefined;
  return row ? fromRow(row) : null;
}

/** Chat documents bound to `threadId` IF `ownerEmail` owns it, newest first. */
export function listForThread(db: DatabaseType, threadId: string, ownerEmail: string): ChatDocRecord[] {
  const rows = db
    .prepare(
      `SELECT cd.* FROM chat_documents cd JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE cd.thread_id = @thread AND t.owner_email = @owner
       ORDER BY cd.updated_at DESC, cd.id DESC`,
    )
    .all({ thread: threadId, owner: ownerEmail }) as DocRow[];
  return rows.map(fromRow);
}

/**
 * Every version of `id`, oldest first, IF `ownerEmail` owns its source thread.
 * Empty for a foreign/unknown source thread OR unknown id (identical, no oracle).
 * The ownership filter is in the SQL so there is no check-then-read seam a caller
 * could skip.
 */
export function getVersions(db: DatabaseType, id: string, ownerEmail: string): ChatDocVersion[] {
  const rows = db
    .prepare(
      `SELECT v.version, v.body, v.format, v.created_at
       FROM chat_document_versions v
       JOIN chat_documents cd ON cd.id = v.doc_id
       JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE v.doc_id = @id AND t.owner_email = @owner
       ORDER BY v.version ASC`,
    )
    .all({ id, owner: ownerEmail }) as Array<{
      version: number;
      body: string;
      format: DocFormat;
      created_at: string;
    }>;
  return rows.map((r) => ({ version: r.version, body: r.body, format: r.format, createdAt: r.created_at }));
}

/** The latest version (number + body) IF `ownerEmail` owns the source thread, else `null`. */
export function latestVersion(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
): { version: number; body: string; format: DocFormat } | null {
  const row = db
    .prepare(
      `SELECT v.version, v.body, v.format
       FROM chat_document_versions v
       JOIN chat_documents cd ON cd.id = v.doc_id
       JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE v.doc_id = @id AND t.owner_email = @owner
       ORDER BY v.version DESC LIMIT 1`,
    )
    .get({ id, owner: ownerEmail }) as { version: number; body: string; format: DocFormat } | undefined;
  return row ? { version: row.version, body: row.body, format: row.format } : null;
}

/**
 * Append a new version and bump `current_version` + `updated_at`, in one
 * transaction. Returns the new version number, or `false` without writing when
 * `ownerEmail` does not own the source thread (foreign/unknown, indistinguishable).
 */
export function addVersion(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  body: string,
  options: AddVersionOptions = {},
): number | false {
  const format = options.format ?? DEFAULT_DOC_FORMAT;
  const now = options.now ?? new Date().toISOString();
  return db.transaction(() => {
    if (!ownsDoc(db, id, ownerEmail)) return false;
    const next = nextVersion(db, CHAT_DOCUMENT_VERSION_STORE, id);
    insertVersion(db, CHAT_DOCUMENT_VERSION_STORE, {
      id,
      version: next,
      body,
      createdAt: now,
      extra: { format },
    });
    db.prepare(`UPDATE chat_documents SET current_version = @v, updated_at = @now WHERE id = @id`).run({
      id,
      v: next,
      now,
    });
    return next;
  })();
}

/**
 * Record (or, on a later Update, advance) the promotion of a chat-doc version to
 * a target. Conditional on the same authority: only writes when `ownerEmail` owns
 * the document's source thread (returns `false` otherwise). One row per
 * `(doc_id, target_type)` so a document may be promoted to one artifact AND one
 * shared doc independently, each with its own Update (upsert on that key).
 */
export function recordPromotion(
  db: DatabaseType,
  p: {
    docId: string;
    ownerEmail: string;
    targetType: PromotionTarget;
    targetId: string;
    promotedVersion: number;
    targetVersionAtPromote: number;
  },
  now: string = new Date().toISOString(),
): boolean {
  return db.transaction(() => {
    if (!ownsDoc(db, p.docId, p.ownerEmail)) return false;
    db.prepare(
      `INSERT INTO chat_document_promotions
         (doc_id, target_type, target_id, promoted_version, target_version_at_promote, created_at)
       VALUES (@doc, @type, @target, @promoted, @targetAt, @now)
       ON CONFLICT (doc_id, target_type) DO UPDATE SET
         target_id = @target,
         promoted_version = @promoted,
         target_version_at_promote = @targetAt,
         created_at = @now`,
    ).run({
      doc: p.docId,
      type: p.targetType,
      target: p.targetId,
      promoted: p.promotedVersion,
      targetAt: p.targetVersionAtPromote,
      now,
    });
    return true;
  })();
}

/**
 * The promotion pointing AT a target, resolved back to its source chat document.
 *
 * The reverse of `getPromotions`, and the only way a publish path can get from
 * the artifact or shared doc it holds to the content job that produced it: the
 * publish paths start from a target id, and the compliance hold keys on the job.
 *
 * Carries the same authority as every other read here, joined through the source
 * thread's owner, so it can never surface a promotion belonging to somebody
 * else. A target that was never promoted, and one promoted by another person,
 * are the same answer.
 */
export function findPromotionByTarget(
  db: DatabaseType,
  targetType: PromotionTarget,
  targetId: string,
  ownerEmail: string,
): ChatDocPromotion | null {
  const row = db
    .prepare(
      `SELECT p.doc_id, p.target_type, p.target_id, p.promoted_version, p.target_version_at_promote, p.created_at
       FROM chat_document_promotions p
       JOIN chat_documents cd ON cd.id = p.doc_id
       JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE p.target_type = @type AND p.target_id = @target AND t.owner_email = @owner`,
    )
    .get({ type: targetType, target: targetId, owner: ownerEmail }) as
    | {
        doc_id: string;
        target_type: PromotionTarget;
        target_id: string;
        promoted_version: number;
        target_version_at_promote: number;
        created_at: string;
      }
    | undefined;
  return row
    ? {
        docId: row.doc_id,
        targetType: row.target_type,
        targetId: row.target_id,
        promotedVersion: row.promoted_version,
        targetVersionAtPromote: row.target_version_at_promote,
        createdAt: row.created_at,
      }
    : null;
}

/**
 * Every promotion recorded for `docId`, IF `ownerEmail` owns its source thread
 * (join on the thread registry), else empty. Owner-scoped in the SQL so a caller
 * who does not own the source thread can never learn a document's promotion state.
 */
export function getPromotions(db: DatabaseType, docId: string, ownerEmail: string): ChatDocPromotion[] {
  const rows = db
    .prepare(
      `SELECT p.doc_id, p.target_type, p.target_id, p.promoted_version, p.target_version_at_promote, p.created_at
       FROM chat_document_promotions p
       JOIN chat_documents cd ON cd.id = p.doc_id
       JOIN threads t ON t.sdk_session_id = cd.thread_id
       WHERE p.doc_id = @doc AND t.owner_email = @owner
       ORDER BY p.target_type ASC`,
    )
    .all({ doc: docId, owner: ownerEmail }) as Array<{
    doc_id: string;
    target_type: PromotionTarget;
    target_id: string;
    promoted_version: number;
    target_version_at_promote: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    docId: r.doc_id,
    targetType: r.target_type,
    targetId: r.target_id,
    promotedVersion: r.promoted_version,
    targetVersionAtPromote: r.target_version_at_promote,
    createdAt: r.created_at,
  }));
}
