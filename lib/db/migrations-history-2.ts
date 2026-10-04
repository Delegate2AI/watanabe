import type Database from "better-sqlite3";

/**
 * Frozen schema migrations v9->v10 through v14->v15. Split out of
 * `migrations.ts` purely to keep that file under the file-size limit as new
 * migrations land; this is historical data, not an active surface. See
 * `migrations.ts` for the ordering contract (indexed by target `user_version`)
 * and the full doc comment.
 */
export const MIGRATIONS_HISTORY_2: Array<(db: Database.Database) => void> = [
  // v9 -> v10: add Projects (spec 26). A project is a clearance-scoped workspace
  // grouping threads and tasks with its own optional agent context. `clearance`
  // is a JSON array of groups (who may see the project), mirroring tasks. A
  // thread belongs to at most one project (project_threads.thread_id is the PK),
  // and a task may be filed to a project via the nullable tasks.project_id
  // column. ADD COLUMN is forward-only and safe here for the same reason as the
  // earlier steps (migrations are keyed off user_version). See lib/db/projects.ts.
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        context TEXT,
        clearance TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_projects_owner ON projects (owner_email);
      CREATE TABLE project_threads (
        thread_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_project_threads_project ON project_threads (project_id);
      ALTER TABLE tasks ADD COLUMN project_id TEXT;
      CREATE INDEX idx_tasks_project ON tasks (project_id);
    `);
  },
  // v10 -> v11: add the activity cursor (per-user last-seen watermark for the
  // combined activity feed).
  (db) => {
    db.exec(`
      CREATE TABLE activity_cursor (
        email TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL
      );
    `);
  },
  // v11 -> v12: add in-chat documents and the canvas pane (spec 29). A chat
  // document is a titled, versioned markdown doc the assistant produced via the
  // `doc_write` tool, bound to one thread and owned by that thread's owner. A
  // promotion row records which chat-doc version was snapshotted to a spec-27
  // artifact or spec-28 shared doc, plus that target's version right after the
  // snapshot, so an additive Update knows where to push and divergence can be
  // detected before advancing the target. See lib/db/chat-docs.ts.
  (db) => {
    db.exec(`
      CREATE TABLE chat_documents (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL,
        current_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_chat_documents_thread ON chat_documents (thread_id, owner_email);
      CREATE INDEX idx_chat_documents_owner_updated ON chat_documents (owner_email, updated_at DESC);
      CREATE TABLE chat_document_versions (
        doc_id TEXT NOT NULL REFERENCES chat_documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, version)
      );
      CREATE TABLE chat_document_promotions (
        doc_id TEXT NOT NULL REFERENCES chat_documents(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('artifact','shared_doc')),
        target_id TEXT NOT NULL,
        promoted_version INTEGER NOT NULL,
        target_version_at_promote INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, target_type)
      );
    `);
  },
  // v12 -> v13: project documents. Files uploaded into a project; bytes live on
  // disk (lib/projects/doc-store.ts), metadata here. Cascades with the project.
  // See lib/db/project-docs.ts.
  (db) => {
    db.exec(`
      CREATE TABLE project_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        uploader_email TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_project_documents_project ON project_documents (project_id, created_at DESC);
    `);
  },
  // v13 -> v14: add the unified documents core and its additive facets. The
  // tables are inert until UNIFIED_DOCS enables code paths that use them.
  (db) => {
    db.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL,
        current_version INTEGER NOT NULL,
        origin_thread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_documents_owner_updated ON documents (owner_email, updated_at DESC);
      CREATE TABLE document_versions (
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        author_email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, version)
      );
      CREATE TABLE document_shares (
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        recipient_email TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('view','comment','edit')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, recipient_email)
      );
      CREATE INDEX idx_document_shares_recipient ON document_shares (recipient_email);
      CREATE TABLE document_comments (
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        id TEXT PRIMARY KEY,
        author_email TEXT NOT NULL,
        body TEXT NOT NULL,
        anchor TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_document_comments_doc ON document_comments (doc_id, created_at);
      CREATE TABLE document_links (
        token TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        access TEXT NOT NULL CHECK (access IN ('view','comment')),
        expires_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_document_links_doc ON document_links (doc_id);
      CREATE TABLE document_publications (
        doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        status TEXT CHECK (status IN ('draft','ready','published')),
        target_path TEXT,
        target_visibility TEXT,
        published_note_path TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);
  },
  // v14 -> v15: team task board (docs/superpowers/specs/2026-07-14-team-task-board-design.md).
  // Allow manual tasks and an in_progress lane. SQLite cannot ALTER a CHECK
  // constraint or drop NOT NULL in place, so rebuild the tasks table: create the
  // new shape, copy every row by explicit column list, drop the old table,
  // rename, and recreate all indexes. source_meeting_id / source_note_path become
  // nullable (manual tasks have no meeting); status gains 'in_progress'; origin
  // gains 'manual'; project_id (added in v9->v10) is preserved.
  (db) => {
    db.exec(`
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assignee_email TEXT,
        source_meeting_id TEXT,
        source_note_path TEXT,
        clearance TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed','open','in_progress','done','dismissed')),
        due TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('circleback','agent','manual')),
        project_id TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO tasks_new (
        id, title, description, assignee_email, source_meeting_id, source_note_path,
        clearance, status, due, origin, project_id, created_at
      )
      SELECT
        id, title, description, assignee_email, source_meeting_id, source_note_path,
        clearance, status, due, origin, project_id, created_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX idx_tasks_meeting ON tasks (source_meeting_id);
      CREATE INDEX idx_tasks_assignee_status ON tasks (assignee_email, status);
      CREATE INDEX idx_tasks_project ON tasks (project_id);
    `);
  },
];
