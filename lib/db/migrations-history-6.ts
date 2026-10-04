import type Database from "better-sqlite3";

/**
 * Migrations v43 onward: personal LLM keys and token budgets
 * (`docs/superpowers/specs/2026-10-03-llm-keys-9router-design.md`).
 */
export const MIGRATIONS_HISTORY_6: Array<(db: Database.Database) => void> = [
  // v43: the LLM key, budget and usage tables. Only the key's sha256 is
  // stored; the raw key leaves the portal once, in the create response.
  (db) => {
    db.exec(`
      CREATE TABLE llm_keys (
        id             TEXT PRIMARY KEY,
        owner_email    TEXT NOT NULL,
        router_key_id  TEXT NOT NULL,
        key_hash       TEXT NOT NULL UNIQUE,
        key_hint       TEXT NOT NULL,
        label          TEXT NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('active','revoked')),
        created_at     TEXT NOT NULL,
        revoked_at     TEXT,
        last_used_at   TEXT
      );
      CREATE INDEX llm_keys_owner ON llm_keys (owner_email, created_at);

      CREATE TABLE llm_model_groups (
        slug            TEXT PRIMARY KEY,
        label           TEXT NOT NULL,
        models          TEXT NOT NULL DEFAULT '[]',
        default_tokens  INTEGER CHECK (default_tokens IS NULL OR default_tokens >= 0),
        period          TEXT NOT NULL CHECK (period IN ('day','week','month')),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE llm_budgets (
        subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('user','team')),
        subject       TEXT NOT NULL,
        group_slug    TEXT NOT NULL,
        tokens        INTEGER CHECK (tokens IS NULL OR tokens >= 0),
        period        TEXT NOT NULL CHECK (period IN ('day','week','month')),
        allowed       INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)),
        updated_by    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (subject_kind, subject, group_slug)
      );

      CREATE TABLE llm_usage (
        owner_email        TEXT NOT NULL,
        group_slug         TEXT NOT NULL,
        period_start       TEXT NOT NULL,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
        bonus_tokens       INTEGER NOT NULL DEFAULT 0,
        requests           INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_email, group_slug, period_start)
      );

      CREATE TABLE llm_usage_daily (
        owner_email        TEXT NOT NULL,
        model              TEXT NOT NULL,
        day                TEXT NOT NULL,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
        requests           INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_email, model, day)
      );

      CREATE TABLE llm_usage_batches (
        batch_id     TEXT PRIMARY KEY,
        received_at  TEXT NOT NULL
      );

      CREATE TABLE llm_budget_requests (
        id                TEXT PRIMARY KEY,
        requester_email   TEXT NOT NULL,
        group_slug        TEXT NOT NULL,
        requested_tokens  INTEGER NOT NULL CHECK (requested_tokens > 0),
        reason            TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        decision          TEXT CHECK (decision IN ('permanent','top_up')),
        granted_tokens    INTEGER,
        decided_by        TEXT,
        decision_note     TEXT,
        task_id           TEXT,
        created_at        TEXT NOT NULL,
        decided_at        TEXT
      );
      CREATE INDEX llm_budget_requests_status ON llm_budget_requests (status, created_at);
    `);
  },
  // v44: indexes for the reads v43 left to full scans. The gate snapshot and
  // both LLM pages read `llm_usage` by period start (its key leads with the
  // owner), the admin page reads `llm_usage_daily` by day range, and every
  // usage push prunes `llm_usage_batches` by age.
  (db) => {
    db.exec(`
      CREATE INDEX llm_usage_period ON llm_usage (period_start);
      CREATE INDEX llm_usage_daily_day ON llm_usage_daily (day);
      CREATE INDEX llm_usage_batches_received ON llm_usage_batches (received_at);
    `);
  },
];
