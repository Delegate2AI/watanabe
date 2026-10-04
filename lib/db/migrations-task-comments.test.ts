import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

/**
 * The task comments step: additive, no backfill. Build a DB at the pre-final
 * schema, seed a task, then open it (which runs only the new final step) and
 * assert the table exists, the index exists, and deleting the task cascades.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-comments-")), "portal.db");
}

function seedPreFinal(file: string): void {
  const db = new Database(file);
  const upTo = MIGRATIONS.length - 1;
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.close();
}

describe("migration: task comments", () => {
  it("creates task_comments with its index and stamps the new user_version", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_comments'`)
      .get();
    expect(table).toBeTruthy();
    const index = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_task_comments_task'`)
      .get();
    expect(index).toBeTruthy();
  });

  it("cascades: deleting a task deletes its comments", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);

    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id, source_note_path,
         clearance, status, due, origin, project_id, created_at)
       VALUES ('t1', 'T', 'd', null, null, null, '["exec"]', 'open', null, 'manual', null,
         '2026-08-07T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO task_comments (id, task_id, author_email, body, created_at, edited_at)
       VALUES ('c1', 't1', 'alice@example.com', 'hello', '2026-08-07T00:01:00.000Z', null)`,
    ).run();

    db.prepare(`DELETE FROM tasks WHERE id = 't1'`).run();
    const left = db.prepare(`SELECT COUNT(*) AS n FROM task_comments`).get() as { n: number };
    expect(left.n).toBe(0);
  });

  it("rejects a comment on a task that does not exist", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);
    expect(() =>
      db.prepare(
        `INSERT INTO task_comments (id, task_id, author_email, body, created_at, edited_at)
         VALUES ('c1', 'nope', 'a@example.com', 'x', '2026-08-07T00:00:00.000Z', null)`,
      ).run(),
    ).toThrow();
  });
});
