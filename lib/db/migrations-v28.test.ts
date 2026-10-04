import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { getTaskForRequester } from "./tasks";

/**
 * v27 -> v28 (attendance as a visibility grant): `tasks.source_attendees`.
 *
 * The risk worth testing is the UPGRADE path. A `:memory:` database always
 * starts at version 0 and runs every step in order, so it proves the fresh path
 * and nothing about a database that already holds the tasks this column is
 * being added for.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v28-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 27 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
 * different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
       source_note_path, clearance, status, due, origin, created_by, created_at)
     VALUES ('t1', 'Fix the background video', 'Shorten it.', NULL, 'circleback:m1',
       'docs/meetings/2026/stream.md', '["admins"]', 'proposed', NULL, 'circleback', NULL,
       '2026-08-05T12:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v27 -> v28", () => {
  it("adds the column to a populated database without disturbing the tasks in it", () => {
    const file = tmpDbPath();
    seedAt(file, 27);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const task = getTaskForRequester(db, "t1", "admin@example.com", ["admins"]);
    expect(task).toMatchObject({ title: "Fix the background video", clearance: ["admins"] });
    db.close();
  });

  it("defaults an existing row to no attendees, so the migration alone grants nobody anything", () => {
    const file = tmpDbPath();
    seedAt(file, 27);
    const db = openDb(file);

    // Empty until `bootTasks()` backfills it from the note. Empty means
    // clearance-only, which is exactly the behaviour before this column existed.
    expect(getTaskForRequester(db, "t1", "admin@example.com", ["admins"])?.sourceAttendees).toEqual([]);
    expect(getTaskForRequester(db, "t1", "dana@example.com", ["all-hands"])).toBeNull();
    db.close();
  });

  it("grants the task to an attendee once the column is populated", () => {
    const file = tmpDbPath();
    seedAt(file, 27);
    const db = openDb(file);

    db.prepare(`UPDATE tasks SET source_attendees = '["dana@example.com"]' WHERE id = 't1'`).run();

    expect(getTaskForRequester(db, "t1", "dana@example.com", ["all-hands"])?.id).toBe("t1");
    db.close();
  });
});
