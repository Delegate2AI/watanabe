import type Database from "better-sqlite3";

export const MIGRATIONS_HISTORY_4: Array<(db: Database.Database) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE project_references_new (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('artifact','shared_doc','kb')),
        target_id  TEXT NOT NULL,
        added_by   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (project_id, kind, target_id)
      );
      INSERT INTO project_references_new
        SELECT id, project_id, kind, target_id, added_by, created_at
        FROM project_references;
      DROP TABLE project_references;
      ALTER TABLE project_references_new RENAME TO project_references;
      CREATE INDEX idx_project_references_project ON project_references (project_id, created_at);
    `);
  },
  (db) => {
    db.exec(`
      ALTER TABLE doc_shares
        ADD COLUMN recipient_kind TEXT NOT NULL DEFAULT 'user'
        CHECK (recipient_kind IN ('user','group'));
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE shared_doc_publications (
        doc_id              TEXT PRIMARY KEY REFERENCES shared_docs(id) ON DELETE CASCADE,
        status              TEXT NOT NULL CHECK (status IN ('in_review','published')),
        target_path         TEXT NOT NULL,
        target_visibility   TEXT NOT NULL,
        published_note_path TEXT,
        mr_url              TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
    `);
  },
  (db) => {
    db.exec(`
      ALTER TABLE tasks
        ADD COLUMN source_attendees TEXT NOT NULL DEFAULT '[]';
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE kb_review_decisions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        iid           INTEGER NOT NULL,
        actor_email   TEXT NOT NULL,
        action        TEXT NOT NULL CHECK (action IN ('approve','reject')),
        paths         TEXT NOT NULL DEFAULT '[]',
        self_approval INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_kb_review_decisions_iid ON kb_review_decisions(iid);
    `);
  },
  (db) => {
    db.exec(`
      ALTER TABLE chat_document_versions
        ADD COLUMN format TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md','html'));
      ALTER TABLE document_versions
        ADD COLUMN format TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md','html'));
      ALTER TABLE artifact_versions
        ADD COLUMN format TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md','html'));
      ALTER TABLE shared_doc_versions
        ADD COLUMN format TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md','html'));
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE mcp_tokens (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX idx_mcp_tokens_owner ON mcp_tokens (owner_email);
    `);
  },
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN completed_at TEXT;`);
  },
  (db) => {
    db.exec(`
      CREATE TABLE doc_access_requests (
        id              TEXT PRIMARY KEY,
        doc_id          TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        requester_email TEXT NOT NULL,
        access          TEXT NOT NULL CHECK (access IN ('view','comment','edit')),
        message         TEXT,
        status          TEXT NOT NULL CHECK (status IN ('pending','granted','declined')),
        created_at      TEXT NOT NULL,
        decided_at      TEXT,
        decided_by      TEXT
      );
      CREATE INDEX idx_doc_access_requests_doc ON doc_access_requests (doc_id, created_at DESC);
      CREATE UNIQUE INDEX idx_doc_access_requests_pending
        ON doc_access_requests (doc_id, requester_email) WHERE status = 'pending';
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE doc_threads (
        thread_id   TEXT PRIMARY KEY,
        doc_id      TEXT NOT NULL REFERENCES shared_docs(id) ON DELETE CASCADE,
        owner_email TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_doc_threads_doc ON doc_threads (doc_id, owner_email, created_at);
      ALTER TABLE doc_suggestions ADD COLUMN via TEXT;
    `);
  },
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]';
      UPDATE tasks SET assignees = json_array(assignee_email) WHERE assignee_email IS NOT NULL;
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE connector_requests (
        id              TEXT PRIMARY KEY,
        requester_email TEXT NOT NULL,
        text            TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        resolved_at     TEXT,
        resolved_by     TEXT
      );
      CREATE INDEX idx_connector_requests_open ON connector_requests (resolved_at, created_at);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE connector_credentials (
        caller_email   TEXT NOT NULL,
        connector_slug TEXT NOT NULL,
        fingerprint    TEXT NOT NULL,
        ciphertext     TEXT NOT NULL,
        key_id         TEXT NOT NULL,
        expires_at     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (caller_email, connector_slug)
      );
      CREATE TABLE connector_oauth_states (
        state          TEXT PRIMARY KEY,
        caller_email   TEXT NOT NULL,
        connector_slug TEXT NOT NULL,
        verifier       TEXT NOT NULL,
        fingerprint    TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL
      );
    `);
  },
  (db) => {
    db.exec(`ALTER TABLE connector_oauth_states ADD COLUMN config_snapshot TEXT NOT NULL DEFAULT '';`);
  },
  // v39: watanabe becomes the MCP authorization server (spec 2026-09-05).
  //
  // `mcp_tokens` gains a client and an expiry, both nullable, because a portal
  // token has neither: it belongs to no OAuth client and never expires. Every
  // row written before this migration therefore reads correctly as a portal
  // token without a backfill, and `resolveToken`'s new expiry clause has to
  // treat NULL as "never" rather than as "already gone".
  (db) => {
    db.exec(`
      ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT;
      ALTER TABLE mcp_tokens ADD COLUMN expires_at TEXT;

      CREATE TABLE oauth_clients (
        client_id     TEXT PRIMARY KEY,
        client_name   TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        last_used_at  TEXT
      );

      -- Single use is enforced by the primary key plus used_at: a replayed code
      -- finds its row already stamped and is refused.
      CREATE TABLE oauth_codes (
        code_hash      TEXT PRIMARY KEY,
        client_id      TEXT NOT NULL,
        owner_email    TEXT NOT NULL,
        redirect_uri   TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        expires_at     TEXT NOT NULL,
        used_at        TEXT
      );

      -- rotated_to chains a refresh token to its successor, so presenting a
      -- superseded one is detectable and revokes the whole chain.
      CREATE TABLE oauth_refresh_tokens (
        token_hash  TEXT PRIMARY KEY,
        client_id   TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        revoked_at  TEXT,
        rotated_to  TEXT
      );
      CREATE INDEX idx_oauth_refresh_owner ON oauth_refresh_tokens (owner_email, created_at);
      CREATE INDEX idx_oauth_codes_expiry ON oauth_codes (expires_at);
    `);
  },

  (db) => {
    db.exec(`
      CREATE TABLE usage_events (
        id                    TEXT PRIMARY KEY,
        result_id             TEXT NOT NULL,
        at                    TEXT NOT NULL,
        source                TEXT NOT NULL CHECK (source IN
                                ('chat','dream','quality','meetings','packages','design')),
        owner_email           TEXT,
        thread_id             TEXT,
        model                 TEXT NOT NULL,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd              REAL NOT NULL DEFAULT 0,
        duration_ms           INTEGER NOT NULL DEFAULT 0,
        ok                    INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX usage_events_at ON usage_events (at);
      CREATE INDEX usage_events_owner_at ON usage_events (owner_email, at);
      CREATE INDEX usage_events_thread ON usage_events (thread_id);
      CREATE UNIQUE INDEX usage_events_result_model ON usage_events (result_id, model);
    `);
  },
];
