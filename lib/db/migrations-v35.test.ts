import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { getForRequester, listByMeeting } from "./tasks";

/**
 * v34 -> v35 (multi-assignee tasks): the new `tasks.assignees` column and its
 * backfill from `assignee_email`.
 *
 * The risk worth testing is the UPGRADE path. A `:memory:` database always
 * starts at version 0 and runs every step in order, so it proves the fresh
 * path and nothing about the rows that already carry a single assignee.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v35-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the
 * rest. The literal 34 is deliberate: `MIGRATIONS.length - 1` silently re-aims
 * at a different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  const insert = db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
       source_note_path, clearance, source_attendees, status, due, origin, created_by, created_at)
     VALUES (@id, @title, 'Body.', @assignee, 'circleback:m1',
       'docs/meetings/2026/stream.md', '["admins"]', '[]', @status, NULL, 'circleback', NULL,
       '2026-08-05T12:00:00Z')`,
  );
  insert.run({ id: "assigned", title: "Shorten the video", assignee: "ken@example.com", status: "open" });
  insert.run({ id: "orphan", title: "Nobody has this", assignee: null, status: "proposed" });
  db.close();
}

describe("migration v34 -> v35", () => {
  it("backfills the assignee list from the single assignee a row already had", () => {
    const file = tmpDbPath();
    seedAt(file, 34);

    const db = openDb(file);

    // At least 35, not exactly: `openDb` runs every later step too, so an exact
    // number here would fail on the next appended migration for no reason. What
    // pins this test to v35 is the `seedAt(file, 34)` literal above.
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(35);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(35);

    const tasks = listByMeeting(db, "circleback:m1");
    expect(tasks.find((task) => task.id === "assigned")).toMatchObject({
      assigneeEmail: "ken@example.com",
      assignees: ["ken@example.com"],
    });
    expect(tasks.find((task) => task.id === "orphan")).toMatchObject({
      assigneeEmail: null,
      assignees: [],
    });
    db.close();
  });

  // The Mine scope and every write guard read the list, so a row that predates
  // the column has to answer the same as one written after it.
  it("keeps a backfilled task in its assignee's own queue", () => {
    const file = tmpDbPath();
    seedAt(file, 34);

    const db = openDb(file);
    expect(getForRequester(db, "ken@example.com", ["admins"]).map((task) => task.id)).toEqual(["assigned", "orphan"]);
    expect(getForRequester(db, "angel@example.com", ["admins"]).map((task) => task.id)).toEqual(["orphan"]);
    db.close();
  });
});
