import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { recordDecision, listDecisions } from "./review-decisions";

/**
 * v28 -> v29 (the review audit trail): the new `kb_review_decisions` table.
 *
 * The risk worth testing is the UPGRADE path. A `:memory:` database always
 * starts at version 0 and runs every step in order, so it proves the fresh path
 * and nothing about a database that already holds the tasks and docs this runs
 * alongside.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v29-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 28 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
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

describe("migration v28 -> v29", () => {
  it("adds the table to a populated database without disturbing what is there", () => {
    const file = tmpDbPath();
    seedAt(file, 28);

    const db = openDb(file);

    // At least 29, not exactly: `openDb` runs every later step too, so an exact
    // number here would fail on the next appended migration for no reason. What
    // pins this test to v29 is the `seedAt(file, 28)` literal above.
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(29);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(29);
    expect(db.prepare(`SELECT title FROM tasks WHERE id = 't1'`).get()).toEqual({
      title: "Fix the background video",
    });
    expect(listDecisions(db, 7)).toEqual([]);
    db.close();
  });

  it("records a decision against an upgraded database", () => {
    const file = tmpDbPath();
    seedAt(file, 28);
    const db = openDb(file);

    recordDecision(db, {
      iid: 7,
      actorEmail: "boss@example.com",
      action: "reject",
      paths: ["docs/a.md"],
      selfApproval: false,
    });

    expect(listDecisions(db, 7)).toEqual([
      expect.objectContaining({ action: "reject", paths: ["docs/a.md"], selfApproval: false }),
    ]);
    db.close();
  });

  it("indexes the table by merge request, which is the only way it is read", () => {
    const file = tmpDbPath();
    seedAt(file, 28);
    const db = openDb(file);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'kb_review_decisions'`)
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain("idx_kb_review_decisions_iid");
    db.close();
  });
});
