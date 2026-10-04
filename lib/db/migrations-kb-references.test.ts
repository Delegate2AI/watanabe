import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

/**
 * The 'kb' reference-kind step rebuilds `project_references` to widen its kind
 * CHECK. A rebuild is where rows go missing, so this seeds the table at the
 * pre-final schema and asserts the existing rows, the index, the uniqueness
 * constraint, and the project cascade all survive the swap.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-kbref-")), "portal.db");
}

function seedPreFinal(file: string): void {
  const db = new Database(file);
  const upTo = MIGRATIONS.length - 1;
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO projects (id, name, description, context, clearance, owner_email, created_at)
     VALUES ('p1', 'Specs', NULL, NULL, '["all-hands"]', 'alice@example.com', '2026-08-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO project_references (id, project_id, kind, target_id, added_by, created_at)
     VALUES ('r1', 'p1', 'shared_doc', 'd1', 'alice@example.com', '2026-08-01T00:00:00Z')`,
  ).run();
  db.close();
}

describe("migration: kb reference kind", () => {
  it("keeps existing rows and admits 'kb' after the rebuild", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const rows = db.prepare(`SELECT id, kind, target_id FROM project_references`).all();
    expect(rows).toEqual([{ id: "r1", kind: "shared_doc", target_id: "d1" }]);

    db.prepare(
      `INSERT INTO project_references (id, project_id, kind, target_id, added_by, created_at)
       VALUES ('r2', 'p1', 'kb', '03-product/trader-score.md', 'alice@example.com', '2026-08-10T00:00:00Z')`,
    ).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM project_references`).get()).toEqual({ n: 2 });

    db.close();
  });

  it("still rejects a kind outside the widened set", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);

    expect(() =>
      db
        .prepare(
          `INSERT INTO project_references (id, project_id, kind, target_id, added_by, created_at)
           VALUES ('r3', 'p1', 'meeting', 'm1', 'alice@example.com', '2026-08-10T00:00:00Z')`,
        )
        .run(),
    ).toThrow();

    db.close();
  });

  it("carries the uniqueness constraint and the project cascade across the swap", () => {
    const file = tmpDbPath();
    seedPreFinal(file);
    const db = openDb(file);

    const insert = db.prepare(
      `INSERT OR IGNORE INTO project_references (id, project_id, kind, target_id, added_by, created_at)
       VALUES (@id, 'p1', 'kb', '03-product/trader-score.md', 'alice@example.com', '2026-08-10T00:00:00Z')`,
    );
    expect(insert.run({ id: "r2" }).changes).toBe(1);
    expect(insert.run({ id: "r3" }).changes).toBe(0);

    const index = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_project_references_project'`)
      .get();
    expect(index).toBeTruthy();

    db.prepare(`DELETE FROM projects WHERE id = 'p1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM project_references`).get()).toEqual({ n: 0 });

    db.close();
  });
});
