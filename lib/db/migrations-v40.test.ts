import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v40-")), "portal.db");
}

function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.close();
}

describe("migration v39 -> v40", () => {
  it("adds usage_events to a database stopped at v39", () => {
    const file = tmpDbPath();
    seedAt(file, 39);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(40);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(40);
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='usage_events'`)
      .get();
    expect(table).toBeDefined();
  });

  it("refuses a source outside the closed set and enforces one row per result and model", () => {
    const db = openDb(":memory:");
    const insert = db.prepare(
      `INSERT INTO usage_events (id, result_id, at, source, owner_email, thread_id, model)
       VALUES (@id, @resultId, @at, @source, NULL, NULL, 'claude-opus-4-8')`,
    );
    const row = { id: "u1", resultId: "r1", at: "2026-09-07T00:00:00.000Z", source: "chat" };

    insert.run(row);
    expect(() => insert.run({ ...row, id: "u2", source: "invented" })).toThrow(/CHECK/i);
    expect(() => insert.run({ ...row, id: "u3" })).toThrow(/UNIQUE/i);
  });

  it("defaults every counter to zero and ok to one", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO usage_events (id, result_id, at, source, owner_email, thread_id, model)
       VALUES ('u1', 'r1', '2026-09-07T00:00:00.000Z', 'dream', NULL, NULL, 'm')`,
    ).run();
    const stored = db.prepare(`SELECT * FROM usage_events WHERE id='u1'`).get() as Record<string, number>;
    expect(stored.input_tokens).toBe(0);
    expect(stored.cost_usd).toBe(0);
    expect(stored.duration_ms).toBe(0);
    expect(stored.ok).toBe(1);
  });
});
