import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `project_documents` access (spec 26 extension). A project document is a file
 * uploaded into a project: its bytes live on disk (lib/projects/doc-store.ts)
 * and its metadata lives here, keyed by `project_id`. Authorization is the
 * PROJECT's: a caller who may see the project may see and manage its documents,
 * so every function here takes an already-authorized `projectId` and does no
 * clearance work of its own (the route resolves project visibility first).
 */

export interface ProjectDocument {
  id: string;
  projectId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  uploaderEmail: string;
  createdAt: string;
}

interface Row {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  uploader_email: string;
  created_at: string;
}

function fromRow(row: Row): ProjectDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploaderEmail: row.uploader_email,
    createdAt: row.created_at,
  };
}

export function insertProjectDocument(db: DatabaseType, doc: ProjectDocument): void {
  db.prepare(
    `INSERT INTO project_documents (id, project_id, filename, content_type, byte_size, uploader_email, created_at)
     VALUES (@id, @projectId, @filename, @contentType, @byteSize, @uploaderEmail, @createdAt)`,
  ).run(doc);
}

export function listProjectDocuments(db: DatabaseType, projectId: string): ProjectDocument[] {
  const rows = db
    .prepare(`SELECT * FROM project_documents WHERE project_id = @projectId ORDER BY created_at DESC, id ASC`)
    .all({ projectId }) as Row[];
  return rows.map(fromRow);
}

/** The document IF it belongs to `projectId`, else null (no cross-project read). */
export function getProjectDocument(db: DatabaseType, projectId: string, id: string): ProjectDocument | null {
  const row = db
    .prepare(`SELECT * FROM project_documents WHERE id = @id AND project_id = @projectId`)
    .get({ id, projectId }) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Delete the document scoped to its project. Returns false if nothing matched. */
export function deleteProjectDocument(db: DatabaseType, projectId: string, id: string): boolean {
  const info = db
    .prepare(`DELETE FROM project_documents WHERE id = @id AND project_id = @projectId`)
    .run({ id, projectId });
  return info.changes > 0;
}
