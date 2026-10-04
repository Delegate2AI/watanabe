import type { Database as DatabaseType } from "better-sqlite3";

interface SourceDocument {
  id: string;
  owner_email: string;
  title: string;
  current_version: number;
  origin_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Promotion {
  doc_id: string;
  target_type: "artifact" | "shared_doc";
  target_id: string;
}

function exists(db: DatabaseType, id: string): boolean {
  return db.prepare(`SELECT 1 FROM documents WHERE id = @id`).get({ id }) !== undefined;
}

function insertDocument(db: DatabaseType, source: SourceDocument): void {
  db.prepare(
    `INSERT INTO documents
       (id, owner_email, title, current_version, origin_thread_id, created_at, updated_at)
     VALUES (@id, @owner_email, @title, @current_version, @origin_thread_id, @created_at, @updated_at)`,
  ).run(source);
}

function copyArtifactFacet(db: DatabaseType, artifactId: string, docId: string): void {
  db.prepare(
    `INSERT INTO document_publications
       (doc_id, status, target_path, target_visibility, published_note_path, created_at, updated_at)
     SELECT @doc, status, target_path, target_visibility, published_note_path, created_at, updated_at
     FROM artifacts WHERE id = @source`,
  ).run({ doc: docId, source: artifactId });
}

function copySharedFacets(db: DatabaseType, sourceId: string, docId: string): void {
  db.prepare(
    `INSERT INTO document_shares (doc_id, recipient_email, access, created_at)
     SELECT @doc, recipient_email, access, created_at FROM doc_shares WHERE doc_id = @source`,
  ).run({ doc: docId, source: sourceId });
  db.prepare(
    `INSERT INTO document_comments (id, doc_id, author_email, body, anchor, created_at)
     SELECT id, @doc, author_email, body, anchor, created_at FROM doc_comments WHERE doc_id = @source`,
  ).run({ doc: docId, source: sourceId });
  db.prepare(
    `INSERT INTO document_links (token, doc_id, access, expires_at, created_at)
     SELECT token, @doc, access, expires_at, created_at FROM doc_links WHERE doc_id = @source`,
  ).run({ doc: docId, source: sourceId });
}

function backfillChatDocuments(db: DatabaseType): void {
  const documents = db.prepare(
    `SELECT cd.id, t.owner_email, cd.title, cd.current_version,
            cd.thread_id AS origin_thread_id, cd.created_at, cd.updated_at
     FROM chat_documents cd JOIN threads t ON t.sdk_session_id = cd.thread_id
     ORDER BY cd.created_at ASC, cd.id ASC`,
  ).all() as SourceDocument[];
  const promotions = db.prepare(
    `SELECT doc_id, target_type, target_id FROM chat_document_promotions
     WHERE doc_id = @doc ORDER BY target_type ASC`,
  );

  for (const document of documents) {
    if (exists(db, document.id)) continue;
    insertDocument(db, document);
    db.prepare(
      // `format` is named explicitly in both lists. Leaving it out of a copy
      // does not fail, it takes the destination default, so every HTML version
      // would arrive labelled markdown: all the rows present and all of them
      // wrong. Any column added to a version table has to be added here too.
      `INSERT INTO document_versions (doc_id, version, body, format, author_email, created_at)
       SELECT @doc, version, body, format, @owner, created_at
       FROM chat_document_versions WHERE doc_id = @doc ORDER BY version ASC`,
    ).run({ doc: document.id, owner: document.owner_email });
    for (const promotion of promotions.all({ doc: document.id }) as Promotion[]) {
      if (promotion.target_type === "artifact") copyArtifactFacet(db, promotion.target_id, document.id);
      else copySharedFacets(db, promotion.target_id, document.id);
    }
  }
}

function backfillArtifacts(db: DatabaseType): void {
  const artifacts = db.prepare(
    `SELECT a.id, a.owner_email, a.title,
            COALESCE((SELECT MAX(version) FROM artifact_versions WHERE artifact_id = a.id), 0) AS current_version,
            NULL AS origin_thread_id, a.created_at, a.updated_at
     FROM artifacts a
     WHERE NOT EXISTS (
       SELECT 1 FROM chat_document_promotions p
       WHERE p.target_type = 'artifact' AND p.target_id = a.id
     ) ORDER BY a.created_at ASC, a.id ASC`,
  ).all() as SourceDocument[];

  for (const artifact of artifacts) {
    if (exists(db, artifact.id)) continue;
    insertDocument(db, artifact);
    db.prepare(
      `INSERT INTO document_versions (doc_id, version, body, format, author_email, created_at)
       SELECT @doc, version, body, format, @owner, created_at
       FROM artifact_versions WHERE artifact_id = @doc ORDER BY version ASC`,
    ).run({ doc: artifact.id, owner: artifact.owner_email });
    copyArtifactFacet(db, artifact.id, artifact.id);
  }
}

function backfillSharedDocuments(db: DatabaseType): void {
  const documents = db.prepare(
    `SELECT d.id, d.owner_email, d.title,
            COALESCE((SELECT MAX(version) FROM shared_doc_versions WHERE doc_id = d.id), 0) AS current_version,
            NULL AS origin_thread_id, d.created_at, d.updated_at
     FROM shared_docs d
     WHERE NOT EXISTS (
       SELECT 1 FROM chat_document_promotions p
       WHERE p.target_type = 'shared_doc' AND p.target_id = d.id
     ) ORDER BY d.created_at ASC, d.id ASC`,
  ).all() as SourceDocument[];

  for (const document of documents) {
    if (exists(db, document.id)) continue;
    insertDocument(db, document);
    db.prepare(
      `INSERT INTO document_versions (doc_id, version, body, format, author_email, created_at)
       SELECT @doc, version, body, format, author_email, created_at
       FROM shared_doc_versions WHERE doc_id = @doc ORDER BY version ASC`,
    ).run({ doc: document.id });
    copySharedFacets(db, document.id, document.id);
  }
}

/** Import legacy document stores, collapsing promoted copies into facets. */
export function backfillDocuments(db: DatabaseType): void {
  db.transaction(() => {
    backfillChatDocuments(db);
    backfillArtifacts(db);
    backfillSharedDocuments(db);
  })();
}
