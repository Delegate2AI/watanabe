import type Database from "better-sqlite3";

export const MIGRATIONS_HISTORY_5: Array<(db: Database.Database) => void> = [
  // v41: widen the usage ledger's source CHECK to admit 'content'.
  //
  // A rebuild, not an ALTER: SQLite cannot modify a CHECK constraint in place.
  // Same shape as the `project_references` widening in history 4. Every index is
  // recreated afterwards, including the UNIQUE (result_id, model) one, which is
  // what makes a re-polled content job idempotent against the ledger rather than
  // needing a guard flag on the job row.
  (db) => {
    db.exec(`
      CREATE TABLE usage_events_new (
        id                    TEXT PRIMARY KEY,
        result_id             TEXT NOT NULL,
        at                    TEXT NOT NULL,
        source                TEXT NOT NULL CHECK (source IN
                                ('chat','dream','quality','meetings','packages','design','content')),
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
      INSERT INTO usage_events_new
        SELECT id, result_id, at, source, owner_email, thread_id, model,
               input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
               cost_usd, duration_ms, ok
        FROM usage_events;
      DROP TABLE usage_events;
      ALTER TABLE usage_events_new RENAME TO usage_events;
      CREATE INDEX usage_events_at ON usage_events (at);
      CREATE INDEX usage_events_owner_at ON usage_events (owner_email, at);
      CREATE INDEX usage_events_thread ON usage_events (thread_id);
      CREATE UNIQUE INDEX usage_events_result_model ON usage_events (result_id, model);
    `);
  },

  //
  // BOTH: a job id on its own answers 404.
  //
  // Authority is `owner_email`, and only that. It is stamped by code that has
  // ALREADY proven the caller owns the place the result lands: `isOwnedBy` on
  // the source thread for a chat document, the actor's own address for a shared
  // one. The landing document's own model stays the fail-closed check, so this
  // table never becomes a second opinion about who may read what.
  //
  // `doc_kind` says which model that is, and it has no default: the writer
  // always knows. `thread_id` is nullable because the other surface has no
  // thread to name. A caller reaching `/api/mcp` gets a synthetic
  // `mcp-<workspaceKey>` id that is NEVER a row in `threads`, so a job scoped
  // through a thread join would have been unreadable by the person who queued it.
  //
  // records whether the ledger row used a measured or an estimated number, so the
  // usage surface is never a silent mix of the two.
  (db) => {
    db.exec(`
      CREATE TABLE content_jobs (
        job_id               TEXT NOT NULL,
        kind                 TEXT NOT NULL CHECK (kind IN ('social_post','email')),
        project              TEXT NOT NULL DEFAULT 'default',
        owner_email          TEXT NOT NULL,
        thread_id            TEXT,
        doc_id               TEXT NOT NULL,
        doc_kind             TEXT NOT NULL CHECK (doc_kind IN ('chat','shared')),
        status               TEXT NOT NULL CHECK (status IN
                               ('queued','running','done','failed','blocked','abandoned')),
        topic                TEXT NOT NULL,
        key_points_json      TEXT NOT NULL DEFAULT '[]',
        source_urls_json     TEXT NOT NULL DEFAULT '[]',
        options_json         TEXT NOT NULL DEFAULT '{}',
        estimated_usd        REAL,
        actual_usd           REAL,
        cost_source          TEXT CHECK (cost_source IN ('actual','estimate')),
        gates_json           TEXT,
        blocked_reason       TEXT,
        failure              TEXT,
        requeue_of           TEXT,
        hold_overridden_by   TEXT,
        hold_override_reason TEXT,
        hold_overridden_at   TEXT,
        queued_at            TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        last_polled_at       TEXT,
        completed_at         TEXT,
        PRIMARY KEY (job_id, kind)
      );
      CREATE INDEX content_jobs_pending ON content_jobs (status, last_polled_at);
      CREATE INDEX content_jobs_owner ON content_jobs (owner_email, queued_at);
      CREATE INDEX content_jobs_doc ON content_jobs (doc_id);
    `);
  },
];
