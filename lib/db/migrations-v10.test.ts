import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

/**
 * Finding 4: an explicit v9 -> v10 transition test. We build a REAL v9 database
 * (migrations 0..8 applied, user_version stamped 9) with representative thread
 * and task rows, then open it through openDb (which runs only the v10 step) and
 * assert existing data survives and the Projects schema is added correctly.
 */

function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v10-")), "portal.db");
}

/** Build a v9 DB at `file` with one thread and one task row, then close it. */
function seedV9(file: string): void {
  const db = new Database(file);
  for (let version = 0; version < 9; version++) MIGRATIONS[version](db);
  db.pragma("user_version = 9");
  db.prepare(
    `INSERT INTO threads (sdk_session_id, owner_email, title, created_at, updated_at)
     VALUES ('t1', 'alice@example.com', 'chat', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id, source_note_path,
       clearance, status, due, origin, created_at)
     VALUES ('k1', 'Task', 'd', 'alice@example.com', 'circleback:m1', 'docs/meetings/m1.md',
       '["all-hands"]', 'proposed', null, 'circleback', '2026-07-01T00:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v9 -> v10 (Projects)", () => {
  it("preserves existing rows and adds the projects schema, ending at v10", () => {
    const file = tmpDbPath();
    seedV9(file);

    const db = openDb(file);
    // openDb always migrates to the latest version. Assert it fully migrated
    // (robust to later appended migrations) rather than pinning an exact number.
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    // Existing data survives the migration untouched.
    const thread = db.prepare(`SELECT sdk_session_id FROM threads`).all() as Array<{ sdk_session_id: string }>;
    expect(thread.map((r) => r.sdk_session_id)).toEqual(["t1"]);
    const task = db.prepare(`SELECT id, project_id FROM tasks`).get() as { id: string; project_id: string | null };
    expect(task.id).toBe("k1");
    // tasks.project_id is added and NULL by default (nullable).
    expect(task.project_id).toBeNull();

    // The new tables exist.
    const tables = (db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'project_threads')`)
      .all() as Array<{ name: string }>).map((r) => r.name).sort();
    expect(tables).toEqual(["project_threads", "projects"]);

    // project_id really is nullable: an insert omitting it succeeds.
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id, source_note_path,
         clearance, status, due, origin, created_at)
       VALUES ('k2', 'T2', 'd', null, 'circleback:m2', 'docs/meetings/m2.md',
         '["all-hands"]', 'proposed', null, 'circleback', '2026-07-02T00:00:00Z')`,
    ).run();
    const k2 = db.prepare(`SELECT project_id FROM tasks WHERE id = 'k2'`).get() as { project_id: string | null };
    expect(k2.project_id).toBeNull();

    db.close();
  });
});
