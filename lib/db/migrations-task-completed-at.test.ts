import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { setStatus, setVisibleStatus } from "./tasks";

/**
 * v31 -> v32 (when a task was finished): the new `tasks.completed_at`.
 *
 * A task carried no completion timestamp, so anything asking "what was
 * completed in this window" had to window on `created_at` instead, which is
 * wrong for exactly the person who closes old work.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v32-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 31 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
 * different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
       source_note_path, clearance, status, due, origin, created_by, created_at)
     VALUES ('old', 'Finished long ago', '', 'alice@example.com', NULL, NULL,
       '["all-hands"]', 'done', NULL, 'manual', NULL, '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.close();
}

describe("migration v31 -> v32", () => {
  it("adds the column to a populated database, leaving history untouched", () => {
    const file = tmpDbPath();
    seedAt(file, 31);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(32);
    // Null, not backfilled to created_at: a task finished before this column
    // existed has no known completion time, and inventing one would be worse
    // than admitting it.
    expect(db.prepare(`SELECT completed_at FROM tasks WHERE id = 'old'`).get()).toEqual({
      completed_at: null,
    });
    db.close();
  });
});

function completedAt(db: Database.Database, id: string): string | null {
  return (db.prepare("SELECT completed_at FROM tasks WHERE id = ?").get(id) as { completed_at: string | null })
    .completed_at;
}

describe("setStatus stamps completion", () => {
  it("records when a task became done", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
         source_note_path, clearance, status, due, origin, created_by, created_at)
       VALUES ('t1', 'Ship it', '', 'alice@example.com', NULL, NULL,
         '["all-hands"]', 'open', NULL, 'manual', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();

    setStatus(db, "t1", "done", undefined, undefined, "2026-08-21T12:00:00.000Z");
    expect(completedAt(db, "t1")).toBe("2026-08-21T12:00:00.000Z");
  });

  it("clears it when a task is reopened, so a stale stamp cannot survive", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
         source_note_path, clearance, status, due, origin, created_by, created_at)
       VALUES ('t1', 'Ship it', '', 'alice@example.com', NULL, NULL,
         '["all-hands"]', 'open', NULL, 'manual', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();

    setStatus(db, "t1", "done", undefined, undefined, "2026-08-21T12:00:00.000Z");
    setStatus(db, "t1", "open", undefined, undefined, "2026-08-22T12:00:00.000Z");
    expect(completedAt(db, "t1")).toBeNull();
  });

  it("leaves it alone on a transition between two unfinished states", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
         source_note_path, clearance, status, due, origin, created_by, created_at)
       VALUES ('t1', 'Ship it', '', 'alice@example.com', NULL, NULL,
         '["all-hands"]', 'open', NULL, 'manual', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();

    setStatus(db, "t1", "in_progress", undefined, undefined, "2026-08-21T12:00:00.000Z");
    expect(completedAt(db, "t1")).toBeNull();
  });
});

/**
 * The path the UI actually takes: the task detail page and the board both send
 * their status changes through `setVisibleStatus`, not `setStatus`. A stamp
 * written in only one of the two would disagree with `status` the moment
 * somebody used the app rather than the API directly.
 */
describe("setVisibleStatus stamps completion too", () => {
  function open(db: Database.Database, id: string): void {
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
         source_note_path, clearance, status, due, origin, created_by, created_at)
       VALUES (?, 'Ship it', '', 'alice@example.com', NULL, NULL,
         '["all-hands"]', 'open', NULL, 'manual', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run(id);
  }

  it("records when a task was completed through the visible path", () => {
    const db = openDb(":memory:");
    open(db, "t1");

    setVisibleStatus(db, "t1", "done", "alice@example.com", ["all-hands"], "2026-08-21T12:00:00.000Z");
    expect(completedAt(db, "t1")).toBe("2026-08-21T12:00:00.000Z");
  });

  it("clears it when the task is reopened through the visible path", () => {
    const db = openDb(":memory:");
    open(db, "t1");

    setVisibleStatus(db, "t1", "done", "alice@example.com", ["all-hands"], "2026-08-21T12:00:00.000Z");
    setVisibleStatus(db, "t1", "in_progress", "alice@example.com", ["all-hands"], "2026-08-22T12:00:00.000Z");
    expect(completedAt(db, "t1")).toBeNull();
  });
});
