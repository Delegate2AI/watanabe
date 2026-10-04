import type Database from "better-sqlite3";

/**
 * Frozen schema migrations v0->v1 through v8->v9. Split out of `migrations.ts`
 * purely to keep that file under the file-size limit as new migrations land;
 * this is historical data, not an active surface. See `migrations.ts` for the
 * ordering contract (indexed by target `user_version`) and the full doc comment.
 */
export const MIGRATIONS_HISTORY_1: Array<(db: Database.Database) => void> = [
  // v0 -> v1: the current schema, verbatim. `IF NOT EXISTS` is intentional so
  // this is safe to run against a legacy DB that already has the tables but is
  // still stamped user_version = 0.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        sdk_session_id TEXT PRIMARY KEY,
        owner_email    TEXT NOT NULL,
        title          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threads_owner_updated
        ON threads (owner_email, updated_at DESC);
    `);
  },
  // v1 -> v2: add memory-consolidation bookkeeping. `dirty` = the thread took a
  // turn that has not yet been dreamed; `dreamed_at` = ISO timestamp of the last
  // consolidation (NULL = never). ADD COLUMN is safe and forward-only here
  // precisely because migrations are keyed off user_version (see the doc above).
  (db) => {
    db.exec(`
      ALTER TABLE threads ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE threads ADD COLUMN dreamed_at TEXT;
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_owner_dirty
        ON threads (owner_email, dirty);
    `);
  },
  // v2 -> v3: add the `packages` table for the update-package ingestion
  // pipeline. Each row tracks one uploaded doc package through its lifecycle
  // (queued -> processing -> submitted | no_changes | failed, with failed and
  // no_changes retryable back to queued). See lib/db/packages.ts.
  (db) => {
    db.exec(`
      CREATE TABLE packages (
        id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, owner_name TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','processing','submitted','no_changes','failed')),
        thread_id TEXT, mr_url TEXT, report TEXT, error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_packages_owner_updated ON packages (owner_email, updated_at DESC);
    `);
  },
  // v3 -> v4: add the per-thread `pinned` flag (spec 24). A pinned thread sorts
  // into the sidebar's Pinned group; the default 0 keeps every existing thread
  // in Recents exactly as before. ADD COLUMN is forward-only and safe here for
  // the same reason as v2 (migrations are keyed off user_version).
  (db) => {
    db.exec(`ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;`);
  },
  // v4 -> v5: add the per-thread model/effort override (spec 24). Both NULL by
  // default, meaning "use the env default at High"; a NULL column leaves every
  // existing thread on exactly the model it ran before. Validation against the
  // allowlist happens at read time (lib/agent/model-options.ts), so a stale or
  // since-removed model id here can never reach the SDK.
  (db) => {
    db.exec(`
      ALTER TABLE threads ADD COLUMN model TEXT;
      ALTER TABLE threads ADD COLUMN effort TEXT;
    `);
  },
  // v5 -> v6: add meeting ingestion lifecycle and idempotency records.
  (db) => {
    db.exec(`
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('queued','processing','done','error')),
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_meetings_state ON meetings (state);
      CREATE TABLE ingested_meetings (
        meeting_id TEXT PRIMARY KEY,
        note_path TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
    `);
  },
  // v6 -> v7: add the `artifacts` + `artifact_versions` tables (spec 27). An
  // artifact is a titled, versioned markdown document owned by a user, captured
  // from chat and (once ready) published to the KB through the write path. Body
  // content is versioned so an edit keeps history. Owner-private until published
  // (see lib/db/artifacts.ts). CASCADE keeps versions from outliving their row.
  (db) => {
    db.exec(`
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        source_thread_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft','ready','published')),
        target_path TEXT,
        target_visibility TEXT,
        published_note_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_artifacts_owner_updated ON artifacts (owner_email, updated_at DESC);
      CREATE TABLE artifact_versions (
        artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version)
      );
    `);
  },
  // v7 -> v8: add clearance-inherited, meeting-derived tasks (spec 21).
  (db) => {
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assignee_email TEXT,
        source_meeting_id TEXT NOT NULL,
        source_note_path TEXT NOT NULL,
        clearance TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed','open','done','dismissed')),
        due TEXT,
        origin TEXT NOT NULL CHECK (origin IN ('circleback','agent')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_tasks_meeting ON tasks (source_meeting_id);
      CREATE INDEX idx_tasks_assignee_status ON tasks (assignee_email, status);
    `);
  },
  // v8 -> v9: add the shared-docs tables (spec 28). A shared doc is a titled,
  // versioned markdown document its owner hands sideways to specific people via
  // an explicit per-recipient ACL (doc_shares: view|comment|edit), separate from
  // KB group clearance. doc_comments back comment/edit access; doc_links are
  // external signed tokens (view|comment only, never edit, optionally expiring,
  // individually revocable). See lib/db/shared-docs.ts and lib/shared-docs/access.ts.
  (db) => {
    db.exec(`
      CREATE TABLE shared_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_shared_docs_owner_updated ON shared_docs (owner_email, updated_at DESC);
      CREATE TABLE shared_doc_versions (
        doc_id TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        author_email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, version)
      );
      CREATE TABLE doc_shares (
        doc_id TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        recipient_email TEXT NOT NULL,
        access TEXT NOT NULL CHECK (access IN ('view','comment','edit')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (doc_id, recipient_email)
      );
      CREATE INDEX idx_doc_shares_recipient ON doc_shares (recipient_email);
      CREATE TABLE doc_comments (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        author_email TEXT NOT NULL,
        body TEXT NOT NULL,
        anchor TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_doc_comments_doc ON doc_comments (doc_id, created_at);
      CREATE TABLE doc_links (
        token TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        access TEXT NOT NULL CHECK (access IN ('view','comment')),
        expires_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_doc_links_doc ON doc_links (doc_id);
    `);
  },
];
