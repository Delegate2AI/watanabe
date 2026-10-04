import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `shared_doc_publications` row access (migration v27): the knowledge-base facet
 * of a shared doc.
 *
 * A row exists only for a document that has actually reached the KB path, so
 * absence is the answer to "has this ever been published", and no `draft` or
 * `ready` state is modelled. Same file-level conventions as the rest of the
 * store: `db` first, named placeholders, and nothing here decides authorization
 * (that is `lib/shared-docs/publish.ts`, one layer up).
 */

export type PublicationStatus = "in_review" | "published";

export interface SharedDocPublication {
  docId: string;
  status: PublicationStatus;
  targetPath: string;
  targetVisibility: string[];
  publishedNotePath: string | null;
  mrUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicationRow {
  doc_id: string;
  status: PublicationStatus;
  target_path: string;
  target_visibility: string;
  published_note_path: string | null;
  mr_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Visibility is stored as JSON. A row written before a shape change, or by hand,
 * must not take down the page that reads it, so an unreadable value degrades to
 * an empty list rather than throwing: the caller renders "unknown", and the
 * publish path never consults this field for an existing note anyway.
 */
function parseVisibility(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: PublicationRow): SharedDocPublication {
  return {
    docId: row.doc_id,
    status: row.status,
    targetPath: row.target_path,
    targetVisibility: parseVisibility(row.target_visibility),
    publishedNotePath: row.published_note_path,
    mrUrl: row.mr_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getPublication(db: DatabaseType, docId: string): SharedDocPublication | null {
  const row = db
    .prepare(`SELECT * FROM shared_doc_publications WHERE doc_id = @docId`)
    .get({ docId }) as PublicationRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Record a publish, replacing any previous one for this document.
 *
 * Upsert rather than insert, because a shared doc keeps living after its first
 * publish: a later revision is legitimately worth publishing again, and the new
 * merge request supersedes the old one. `created_at` is preserved on conflict so
 * the row still says when this document first reached the KB.
 */
export function recordPublication(
  db: DatabaseType,
  p: {
    docId: string;
    status: PublicationStatus;
    targetPath: string;
    targetVisibility: string[];
    publishedNotePath?: string | null;
    mrUrl?: string | null;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO shared_doc_publications
       (doc_id, status, target_path, target_visibility, published_note_path, mr_url, created_at, updated_at)
     VALUES (@docId, @status, @targetPath, @targetVisibility, @publishedNotePath, @mrUrl, @now, @now)
     ON CONFLICT(doc_id) DO UPDATE SET
       status = @status,
       target_path = @targetPath,
       target_visibility = @targetVisibility,
       published_note_path = @publishedNotePath,
       mr_url = @mrUrl,
       updated_at = @now`,
  ).run({
    docId: p.docId,
    status: p.status,
    targetPath: p.targetPath,
    targetVisibility: JSON.stringify(p.targetVisibility),
    publishedNotePath: p.publishedNotePath ?? null,
    mrUrl: p.mrUrl ?? null,
    now,
  });
}
