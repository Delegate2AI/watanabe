import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { listTokens, mintToken, resolveToken } from "@/lib/mcp-auth/tokens";

/**
 * v30 -> v31 (MCP client credentials): the new `mcp_tokens` table.
 *
 * The risk worth testing is the UPGRADE path. A `:memory:` database always
 * starts at version 0 and runs every step, so it proves the fresh path and
 * nothing about a database that already holds live rows.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v31-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 30 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
 * different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO tasks (id, title, description, assignee_email, source_meeting_id,
       source_note_path, clearance, status, due, origin, created_by, created_at)
     VALUES ('t1', 'Keep this row', 'Untouched by the upgrade.', NULL, NULL,
       NULL, '["admins"]', 'proposed', NULL, 'manual', NULL, '2026-08-21T12:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v30 -> v31", () => {
  it("adds the table to a populated database without disturbing what is there", () => {
    const file = tmpDbPath();
    seedAt(file, 30);

    const db = openDb(file);

    // At least 31, not exactly: `openDb` runs every later step too. What pins
    // this test to v31 is the `seedAt(file, 30)` literal above.
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(31);
    expect(db.prepare(`SELECT title FROM tasks WHERE id = 't1'`).get()).toEqual({ title: "Keep this row" });
    expect(listTokens(db, "alice@example.com")).toEqual([]);
    db.close();
  });

  it("mints and resolves against an upgraded database", () => {
    const file = tmpDbPath();
    seedAt(file, 30);
    const db = openDb(file);

    const { id, token } = mintToken(db, { ownerEmail: "alice@example.com", name: "laptop" });
    expect(resolveToken(db, token)).toEqual({ id, ownerEmail: "alice@example.com" });
    db.close();
  });

  it("refuses two rows with the same hash, which is what makes a lookup by hash the whole check", () => {
    const file = tmpDbPath();
    seedAt(file, 30);
    const db = openDb(file);

    db.prepare(
      `INSERT INTO mcp_tokens (id, owner_email, name, token_hash, created_at)
       VALUES ('a', 'alice@example.com', 'one', 'same-hash', '2026-08-21T12:00:00Z')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO mcp_tokens (id, owner_email, name, token_hash, created_at)
           VALUES ('b', 'bob@example.com', 'two', 'same-hash', '2026-08-21T12:00:00Z')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
