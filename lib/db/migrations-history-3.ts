import type Database from "better-sqlite3";

/**
 * Frozen schema migrations v15->v16 through v23->v24. Split out of
 * `migrations.ts` purely to keep that file under the file-size limit as new
 * migrations land; this is historical data, not an active surface. See
 * `migrations.ts` for the ordering contract (indexed by target `user_version`)
 * and the full doc comment.
 */

/**
 * Copy legacy flat `doc_comments` rows into the thread model as single-message
 * open general threads (anchor NULL). Deterministic and idempotent: the thread
 * reuses the comment id, the message id is `${comment.id}-m`, and INSERT OR
 * IGNORE means re-running is a no-op. Called by the v16 migration.
 */
export function backfillFlatComments(db: Database.Database): void {
  const rows = db
    .prepare(`SELECT id, doc_id, author_email, body, created_at FROM doc_comments`)
    .all() as Array<{ id: string; doc_id: string; author_email: string; body: string; created_at: string }>;
  const thread = db.prepare(
    `INSERT OR IGNORE INTO doc_comment_threads (id, doc_id, anchor_json, status, created_by, created_at)
     VALUES (@id, @doc, NULL, 'open', @author, @created)`,
  );
  const message = db.prepare(
    `INSERT OR IGNORE INTO doc_comment_messages (id, thread_id, author_email, body, created_at)
     VALUES (@id, @thread, @author, @body, @created)`,
  );
  for (const r of rows) {
    thread.run({ id: r.id, doc: r.doc_id, author: r.author_email, created: r.created_at });
    message.run({ id: `${r.id}-m`, thread: r.id, author: r.author_email, body: r.body, created: r.created_at });
  }
}

export const MIGRATIONS_HISTORY_3: Array<(db: Database.Database) => void> = [
  // v15 -> v16: document annotations (docs/superpowers/specs/2026-07-22-doc-comments-and-suggestions-design.md).
  // Anchored, threaded, resolvable comment threads plus proposed edits
  // (suggestions). Additive and inert until DOC_ANNOTATIONS_ENABLED is on. The
  // backfill folds legacy flat doc_comments into open general threads so nothing
  // is lost when the flag is first enabled on an existing deployment.
  (db) => {
    db.exec(`
      CREATE TABLE doc_comment_threads (
        id           TEXT PRIMARY KEY,
        doc_id       TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        anchor_json  TEXT,
        status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
        created_by   TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        resolved_by  TEXT,
        resolved_at  TEXT
      );
      CREATE INDEX idx_doc_comment_threads_doc ON doc_comment_threads (doc_id, created_at);
      CREATE TABLE doc_comment_messages (
        id           TEXT PRIMARY KEY,
        thread_id    TEXT NOT NULL REFERENCES doc_comment_threads(id) ON DELETE CASCADE,
        author_email TEXT NOT NULL,
        body         TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_doc_comment_messages_thread ON doc_comment_messages (thread_id, created_at);
      CREATE TABLE doc_suggestions (
        id              TEXT PRIMARY KEY,
        doc_id          TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        base_version    INTEGER NOT NULL,
        anchor_json     TEXT NOT NULL,
        original_text   TEXT NOT NULL,
        proposed_text   TEXT NOT NULL,
        note            TEXT,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','stale')),
        created_by      TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        resolved_by     TEXT,
        resolved_at     TEXT,
        applied_version INTEGER
      );
      CREATE INDEX idx_doc_suggestions_doc ON doc_suggestions (doc_id, created_at);
    `);
    backfillFlatComments(db);
  },
  // v16 -> v17: tasks.created_by (docs/superpowers/specs/2026-07-23-task-lifecycle-design.md).
  // The lifecycle spec gives a task's creator the right to delete it, and the
  // table had no way to say who that was. Without the column the only available
  // approximation was "the assignee of a manual task", which inverts the rule:
  // it would let the person a task was handed to delete it while the person who
  // wrote it could not. Nullable, so existing rows stay honest about not
  // knowing; a NULL creator falls back to admin-only deletion.
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN created_by TEXT`);
  },
  // v17 -> v18: project_references (docs/superpowers/specs/2026-07-23-surface-polish-design.md, P-05).
  // A project could only take NEW content in, through Upload, while its own
  // working context named artifacts and shared docs that already existed. This
  // table stores a REFERENCE (kind + target id), never a copy: the target keeps
  // its own owner and its own ACL, and the project view resolves that access at
  // read time. Revoking access to the target therefore hides it from the project
  // without deleting the row, and re-granting brings it back.
  (db) => {
    db.exec(`
      CREATE TABLE project_references (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('artifact','shared_doc')),
        target_id  TEXT NOT NULL,
        added_by   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, kind, target_id)
      );
      CREATE INDEX idx_project_references_project ON project_references (project_id, created_at);
    `);
  },
  // v18 -> v19: per-thread external connector opt-in (spec 33).
  (db) => {
    db.exec(`
      CREATE TABLE thread_connectors (
        thread_id      TEXT NOT NULL,
        connector_slug TEXT NOT NULL,
        enabled_at     TEXT NOT NULL,
        PRIMARY KEY (thread_id, connector_slug)
      );
    `);
  },
  // v19 -> v20: meeting_payloads, the store behind Circleback webhook ingestion.
  // The poll path can always re-fetch a meeting by id, so it needed no payload
  // store. A webhook cannot: it delivers meetings recorded by OTHER workspace
  // members, and re-reading those by id would use the operator's own token and
  // fail with exactly the permission wall the webhook exists to route around.
  // The pushed body is therefore the only copy we will ever hold, and it is
  // stored verbatim (not as the parsed shape) so a later parser fix can be
  // replayed over meetings already received.
  (db) => {
    db.exec(`
      CREATE TABLE meeting_payloads (
        meeting_id  TEXT PRIMARY KEY,
        payload     TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  },
  // v20 -> v21: widen the artifacts status CHECK to admit 'in_review'.
  // An `mr` publish opens a merge request; the note is not in the knowledge base
  // until someone merges it. The old three-state CHECK had nowhere to put that,
  // so the publish path marked such artifacts 'published' and the UI told the
  // contributor their change was live while it sat unmerged.
  //
  // SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. The care
  // here is `artifact_versions`, which references artifacts(id) ON DELETE
  // CASCADE: better-sqlite3 turns foreign keys ON by default, so `DROP TABLE
  // artifacts` cascades and empties the version history. `PRAGMA foreign_keys`
  // cannot be changed from in here, because `migrate()` runs every step inside
  // a transaction and the pragma is a no-op there. So the child rows are set
  // aside and restored explicitly. The table itself survives the cascade (rows
  // are deleted, not the table), which is why re-inserting is enough.
  // Covered by migrations-artifacts.test.ts, which is what caught the data loss.
  (db) => {
    db.exec(`
      CREATE TABLE artifacts_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        source_thread_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft','ready','in_review','published')),
        target_path TEXT,
        target_visibility TEXT,
        published_note_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO artifacts_new
        SELECT id, title, owner_email, source_thread_id, status, target_path,
               target_visibility, published_note_path, created_at, updated_at
        FROM artifacts;
      CREATE TEMP TABLE artifact_versions_backup AS SELECT * FROM artifact_versions;
      DROP TABLE artifacts;
      ALTER TABLE artifacts_new RENAME TO artifacts;
      CREATE INDEX idx_artifacts_owner_updated ON artifacts (owner_email, updated_at DESC);
      INSERT INTO artifact_versions SELECT * FROM artifact_versions_backup;
      DROP TABLE artifact_versions_backup;
    `);
  },
  // v21 -> v22: admit 'in_review' in document_publications too.
  // `backfillDocuments()` copies an artifact's status straight into this table,
  // so the moment v21 made `in_review` reachable, backfilling an artifact in
  // that state would violate this CHECK and roll back the whole import. The
  // unified documents model has to know every status the artifact model holds.
  // Rebuilt rather than altered for the same reason as v21 (SQLite cannot ALTER
  // a CHECK); document_publications has no children, so nothing cascades.
  (db) => {
    db.exec(`
      CREATE TABLE document_publications_new (
        doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        status TEXT CHECK (status IN ('draft','ready','in_review','published')),
        target_path TEXT,
        target_visibility TEXT,
        published_note_path TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      INSERT INTO document_publications_new
        SELECT doc_id, status, target_path, target_visibility, published_note_path, created_at, updated_at
        FROM document_publications;
      DROP TABLE document_publications;
      ALTER TABLE document_publications_new RENAME TO document_publications;
    `);
  },
  // v22 -> v23: artifacts.mr_url + artifacts.mr_iid.
  // An `mr` publish had nowhere to record WHICH merge request it opened, so the
  // URL lived only in transient client state and was gone on reload: an artifact
  // sat in `in_review` with no way to reach its own review, and nothing could
  // ever ask GitLab whether that review had finished. The url is for the reader,
  // the iid is what the reconciler queries.
  //
  // A SEPARATE, ADDITIVE migration rather than a tweak to the v21 rebuild, which
  // is where these columns first (wrongly) lived. `migrate()` only runs steps
  // ABOVE the stored user_version, so editing v21 left every database that had
  // already run it, including every developer's, permanently without the
  // columns; the next MR publish there would fail with `no such column` AFTER
  // having created the merge request. A migration that has executed anywhere is
  // frozen. Both nullable: only an mr publish ever sets them.
  (db) => {
    db.exec(`
      ALTER TABLE artifacts ADD COLUMN mr_url TEXT;
      ALTER TABLE artifacts ADD COLUMN mr_iid INTEGER;
    `);
  },
  // v23 -> v24: task comments (docs/superpowers/specs/2026-08-07-task-comments-design.md).
  // Flat, one row per comment, no thread table and no anchors: a task is one
  // item that already has a status, so it needs neither a second resolvable
  // axis nor a place in a document to point at. Additive with no backfill,
  // and inert until TASK_COMMENTS_ENABLED is on.
  //
  // The cascade from tasks(id) is real, because PRAGMA foreign_keys is ON in
  // this codebase. Any later migration that rebuilds `tasks` by copy-and-swap
  // must back these rows up first or it silently empties every discussion, the
  // same trap already documented above for artifact_versions.
  (db) => {
    db.exec(`
      CREATE TABLE task_comments (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_email TEXT NOT NULL,
        body         TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        edited_at    TEXT
      );
      CREATE INDEX idx_task_comments_task ON task_comments (task_id, created_at);
    `);
  },
];
