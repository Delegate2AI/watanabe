import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb } from "./client";
import { MIGRATIONS } from "./migrations";

// Connection-hardening tests: the pragmas that keep a momentarily-locked write
// from silently orphaning a session (busy_timeout) and pin the WAL durability
// posture (synchronous), plus the user_version migration runner that must be
// safe against databases already deployed in the wild.

const tmpFiles: string[] = [];

function tmpDbPath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-")), "portal.db");
  tmpFiles.push(path.dirname(p));
  return p;
}

afterEach(() => {
  while (tmpFiles.length) {
    const dir = tmpFiles.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("openDb pragmas", () => {
  it("sets busy_timeout (5s default) and synchronous = NORMAL (1)", () => {
    const db = openDb(":memory:");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    // SQLite synchronous levels: OFF=0, NORMAL=1, FULL=2.
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
    db.close();
  });

  it("honours PORTAL_DB_BUSY_TIMEOUT_MS override", () => {
    const prev = process.env.PORTAL_DB_BUSY_TIMEOUT_MS;
    process.env.PORTAL_DB_BUSY_TIMEOUT_MS = "1234";
    try {
      const db = openDb(":memory:");
      expect(db.pragma("busy_timeout", { simple: true })).toBe(1234);
      db.close();
    } finally {
      if (prev === undefined) delete process.env.PORTAL_DB_BUSY_TIMEOUT_MS;
      else process.env.PORTAL_DB_BUSY_TIMEOUT_MS = prev;
    }
  });
});

describe("schema migration (user_version)", () => {
  it("(b) a fresh DB ends at the latest user_version with the threads table + index present", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'`)
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("threads");

    const index = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_threads_owner_updated'`)
      .get() as { name: string } | undefined;
    expect(index?.name).toBe("idx_threads_owner_updated");
    db.close();
  });

  it("(c) KEY TEST: migrates a legacy DB (tables exist, user_version = 0) without error or data loss", () => {
    const file = tmpDbPath();

    // Reproduce a DB created by the OLD code path: tables via bare
    // CREATE TABLE IF NOT EXISTS, and user_version left at its default 0.
    const legacy = new Database(file);
    legacy.pragma("journal_mode = WAL");
    legacy.exec(`
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
    expect(legacy.pragma("user_version", { simple: true })).toBe(0);
    // A real row already present before any migration runs.
    legacy
      .prepare(
        `INSERT INTO threads (sdk_session_id, owner_email, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("legacy-1", "alice@x.com", "pre-existing", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");
    legacy.close();

    // Now open through the migrate path: must succeed and stamp the latest version.
    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    // Data survived, exactly once (no loss, no duplication).
    const rows = db.prepare(`SELECT * FROM threads`).all() as Array<{
      sdk_session_id: string;
      owner_email: string;
      title: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sdk_session_id: "legacy-1",
      owner_email: "alice@x.com",
      title: "pre-existing",
    });
    db.close();
  });

  it("(d) re-opening an already-migrated DB is idempotent and keeps data", () => {
    const file = tmpDbPath();

    const first = openDb(file);
    first
      .prepare(
        `INSERT INTO threads (sdk_session_id, owner_email, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("s1", "bob@x.com", "hello", "2026-06-02T00:00:00Z", "2026-06-02T00:00:00Z");
    expect(first.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    first.close();

    // Second open is a no-op migration: nothing to run and data stays intact.
    const second = openDb(file);
    expect(second.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const rows = second.prepare(`SELECT sdk_session_id FROM threads`).all() as Array<{ sdk_session_id: string }>;
    expect(rows.map((r) => r.sdk_session_id)).toEqual(["s1"]);
    second.close();
  });
});
