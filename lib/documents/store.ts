import type { Database as DatabaseType } from "better-sqlite3";
import { insertVersion, listVersions as listStoredVersions, nextVersion } from "./version-store";
import { DEFAULT_DOC_FORMAT, type DocFormat } from "./types";
import type {
  DocumentAccess,
  DocumentComment,
  DocumentDisposition,
  DocumentLink,
  DocumentLinkAccess,
  DocumentPublication,
  DocumentRecord,
  DocumentShare,
  DocumentVersion,
  PublicationStatus,
} from "./types";

const VERSION_STORE = {
  table: "document_versions",
  fkColumn: "doc_id",
  extraColumns: ["author_email", "format"],
} as const;
const VERSION_COLUMNS = ["version", "body", "format", "author_email", "created_at"] as const;

interface DocumentRow {
  id: string;
  owner_email: string;
  title: string;
  current_version: number;
  origin_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

function documentFromRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    currentVersion: row.current_version,
    originThreadId: row.origin_thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDocument(
  db: DatabaseType,
  input: {
    id: string;
    ownerEmail: string;
    title: string;
    body: string;
    format?: DocFormat;
    originThreadId: string | null;
  },
  now: string = new Date().toISOString(),
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO documents
         (id, owner_email, title, current_version, origin_thread_id, created_at, updated_at)
       VALUES (@id, @owner, @title, 1, @thread, @now, @now)`,
    ).run({ id: input.id, owner: input.ownerEmail, title: input.title, thread: input.originThreadId, now });
    insertVersion(db, VERSION_STORE, {
      id: input.id,
      version: 1,
      body: input.body,
      extra: { author_email: input.ownerEmail, format: input.format ?? DEFAULT_DOC_FORMAT },
      createdAt: now,
    });
  })();
}

export function getDocument(db: DatabaseType, id: string): DocumentRecord | null {
  const row = db.prepare(`SELECT * FROM documents WHERE id = @id`).get({ id }) as DocumentRow | undefined;
  return row ? documentFromRow(row) : null;
}

export function listDocuments(db: DatabaseType, ownerEmail?: string): DocumentRecord[] {
  const rows = ownerEmail
    ? (db.prepare(`SELECT * FROM documents WHERE owner_email = @owner ORDER BY updated_at DESC`).all({ owner: ownerEmail }) as DocumentRow[])
    : (db.prepare(`SELECT * FROM documents ORDER BY updated_at DESC`).all() as DocumentRow[]);
  return rows.map(documentFromRow);
}

export function updateDocument(
  db: DatabaseType,
  id: string,
  patch: { title?: string },
  now: string = new Date().toISOString(),
): boolean {
  if (patch.title === undefined) return false;
  return db.prepare(`UPDATE documents SET title = @title, updated_at = @now WHERE id = @id`).run({ id, title: patch.title, now }).changes > 0;
}

export function addVersion(
  db: DatabaseType,
  id: string,
  authorEmail: string,
  body: string,
  options: { format?: DocFormat; now?: string } = {},
): number | false {
  const format = options.format ?? DEFAULT_DOC_FORMAT;
  const now = options.now ?? new Date().toISOString();
  return db.transaction(() => {
    if (!db.prepare(`SELECT 1 FROM documents WHERE id = @id`).get({ id })) return false;
    const version = nextVersion(db, VERSION_STORE, id);
    insertVersion(db, VERSION_STORE, {
      id,
      version,
      body,
      extra: { author_email: authorEmail, format },
      createdAt: now,
    });
    db.prepare(`UPDATE documents SET current_version = @version, updated_at = @now WHERE id = @id`).run({ id, version, now });
    return version;
  })();
}

export function listVersions(db: DatabaseType, id: string): DocumentVersion[] {
  const rows = listStoredVersions<{
    version: number;
    body: string;
    format: DocFormat;
    author_email: string;
    created_at: string;
  }>(db, VERSION_STORE, id, VERSION_COLUMNS);
  return rows.map((row) => ({
    version: row.version,
    body: row.body,
    format: row.format,
    authorEmail: row.author_email,
    createdAt: row.created_at,
  }));
}

export function upsertShare(
  db: DatabaseType,
  docId: string,
  recipientEmail: string,
  access: DocumentAccess,
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO document_shares (doc_id, recipient_email, access, created_at)
     VALUES (@doc, @recipient, @access, @now)
     ON CONFLICT (doc_id, recipient_email) DO UPDATE SET access = @access`,
  ).run({ doc: docId, recipient: recipientEmail, access, now });
}

export function listShares(db: DatabaseType, docId: string): DocumentShare[] {
  const rows = db.prepare(
    `SELECT recipient_email, access, created_at FROM document_shares
     WHERE doc_id = @doc ORDER BY created_at ASC, recipient_email ASC`,
  ).all({ doc: docId }) as Array<{ recipient_email: string; access: DocumentAccess; created_at: string }>;
  return rows.map((row) => ({ recipientEmail: row.recipient_email, access: row.access, createdAt: row.created_at }));
}

export function removeShare(db: DatabaseType, docId: string, recipientEmail: string): boolean {
  return db.prepare(`DELETE FROM document_shares WHERE doc_id = @doc AND recipient_email = @recipient`)
    .run({ doc: docId, recipient: recipientEmail }).changes > 0;
}

export function addComment(
  db: DatabaseType,
  input: { id: string; docId: string; authorEmail: string; body: string; anchor: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO document_comments (id, doc_id, author_email, body, anchor, created_at)
     VALUES (@id, @doc, @author, @body, @anchor, @now)`,
  ).run({ id: input.id, doc: input.docId, author: input.authorEmail, body: input.body, anchor: input.anchor, now });
}

export function listComments(db: DatabaseType, docId: string): DocumentComment[] {
  const rows = db.prepare(
    `SELECT id, author_email, body, anchor, created_at FROM document_comments
     WHERE doc_id = @doc ORDER BY created_at ASC, id ASC`,
  ).all({ doc: docId }) as Array<{ id: string; author_email: string; body: string; anchor: string | null; created_at: string }>;
  return rows.map((row) => ({ id: row.id, authorEmail: row.author_email, body: row.body, anchor: row.anchor, createdAt: row.created_at }));
}

export function removeComment(db: DatabaseType, docId: string, id: string): boolean {
  return db.prepare(`DELETE FROM document_comments WHERE doc_id = @doc AND id = @id`).run({ doc: docId, id }).changes > 0;
}

export function addLink(
  db: DatabaseType,
  input: { token: string; docId: string; access: DocumentLinkAccess; expiresAt: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO document_links (token, doc_id, access, expires_at, created_at)
     VALUES (@token, @doc, @access, @expires, @now)`,
  ).run({ token: input.token, doc: input.docId, access: input.access, expires: input.expiresAt, now });
}

export function listLinks(db: DatabaseType, docId: string): DocumentLink[] {
  const rows = db.prepare(
    `SELECT token, access, expires_at, created_at FROM document_links
     WHERE doc_id = @doc ORDER BY created_at ASC, token ASC`,
  ).all({ doc: docId }) as Array<{ token: string; access: DocumentLinkAccess; expires_at: string | null; created_at: string }>;
  return rows.map((row) => ({ token: row.token, access: row.access, expiresAt: row.expires_at, createdAt: row.created_at }));
}

export function removeLink(db: DatabaseType, docId: string, token: string): boolean {
  return db.prepare(`DELETE FROM document_links WHERE doc_id = @doc AND token = @token`).run({ doc: docId, token }).changes > 0;
}

function parseVisibility(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function addPublication(
  db: DatabaseType,
  input: { docId: string; status: PublicationStatus; targetPath: string | null; targetVisibility: string[] | null; publishedNotePath: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO document_publications
       (doc_id, status, target_path, target_visibility, published_note_path, created_at, updated_at)
     VALUES (@doc, @status, @path, @visibility, @publishedPath, @now, @now)
     ON CONFLICT (doc_id) DO UPDATE SET status = @status, target_path = @path,
       target_visibility = @visibility, published_note_path = @publishedPath, updated_at = @now`,
  ).run({ doc: input.docId, status: input.status, path: input.targetPath, visibility: input.targetVisibility === null ? null : JSON.stringify(input.targetVisibility), publishedPath: input.publishedNotePath, now });
}

export function getPublication(db: DatabaseType, docId: string): DocumentPublication | null {
  const row = db.prepare(`SELECT * FROM document_publications WHERE doc_id = @doc`).get({ doc: docId }) as
    | { status: PublicationStatus; target_path: string | null; target_visibility: string | null; published_note_path: string | null; created_at: string; updated_at: string }
    | undefined;
  return row ? { status: row.status, targetPath: row.target_path, targetVisibility: parseVisibility(row.target_visibility), publishedNotePath: row.published_note_path, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export function removePublication(db: DatabaseType, docId: string): boolean {
  return db.prepare(`DELETE FROM document_publications WHERE doc_id = @doc`).run({ doc: docId }).changes > 0;
}

export function dispositionFor(db: DatabaseType, docId: string): DocumentDisposition {
  const row = db.prepare(
    `SELECT EXISTS(SELECT 1 FROM document_shares WHERE doc_id = @doc) AS shared,
            EXISTS(SELECT 1 FROM document_publications WHERE doc_id = @doc) AS published`,
  ).get({ doc: docId }) as { shared: number; published: number };
  const shared = row.shared === 1;
  const published = row.published === 1;
  return { private: !shared && !published, shared, published };
}

export function deleteDocument(db: DatabaseType, id: string): boolean {
  return db.transaction(() => {
    if (!db.prepare(`SELECT 1 FROM documents WHERE id = @id`).get({ id })) return false;
    for (const table of ["document_versions", "document_shares", "document_comments", "document_links", "document_publications"])
      db.prepare(`DELETE FROM ${table} WHERE doc_id = @id`).run({ id });
    db.prepare(`DELETE FROM documents WHERE id = @id`).run({ id });
    return true;
  })();
}
