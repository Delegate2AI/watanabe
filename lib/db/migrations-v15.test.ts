import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

/**
 * v14 -> v15 (team task board): the tasks table is rebuilt so manual tasks
 * (nullable meeting source, origin 'manual') and an 'in_progress' lane are
 * allowed. Build a DB at the pre-final schema, seed a legacy meeting-derived
 * task with project_id set, then open it (which runs only the final step) and
 * assert the row survives and the new capabilities work.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v15-")), "portal.db");
}

function seedPreFinal(file: string): void {
  const db = new Database(file);
  const upTo = MIGRATIONS.length - 1; // every migration except the new final one
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id, source_note_path,
       clearance, status, due, origin, project_id, created_at)
     VALUES ('legacy', 'Legacy', 'd', 'alice@example.com', 'circleback:m1', 'docs/meetings/m1.md',
       '["exec"]', 'open', null, 'circleback', 'p1', '2026-07-01T00:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v14 -> v15 (team task board)", () => {
  it("rebuilds tasks: preserves rows and project_id, allows manual + in_progress, rejects bad status", () => {
    const file = tmpDbPath();
    seedPreFinal(file);

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    // Existing row survives with its project_id.
    const legacy = db.prepare(`SELECT status, project_id FROM tasks WHERE id = 'legacy'`).get() as {
      status: string; project_id: string | null;
    };
    expect(legacy.status).toBe("open");
    expect(legacy.project_id).toBe("p1");

    // A manual task with NULL meeting source, origin 'manual', status 'in_progress' is accepted.
    db.prepare(
      `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id, source_note_path,
         clearance, status, due, origin, project_id, created_at)
       VALUES ('m1', 'Manual', 'd', null, null, null,
         '["all-hands"]', 'in_progress', null, 'manual', null, '2026-07-14T00:00:00Z')`,
    ).run();
    const manual = db.prepare(`SELECT source_meeting_id, origin, status FROM tasks WHERE id = 'm1'`).get() as {
      source_meeting_id: string | null; origin: string; status: string;
    };
    expect(manual.source_meeting_id).toBeNull();
    expect(manual.origin).toBe("manual");
    expect(manual.status).toBe("in_progress");

    // The CHECK constraints still bite.
    expect(() =>
      db.prepare(
        `INSERT INTO tasks (id, title, description, clearance, status, origin, created_at)
         VALUES ('bad', 'T', 'd', '[]', 'nope', 'manual', '2026-07-14T00:00:00Z')`,
      ).run(),
    ).toThrow();

    db.close();
  });
});
