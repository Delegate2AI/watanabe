import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { listPending, requestAccess } from "./doc-access-requests";

/**
 * v32 -> v33 (access requests): the new `doc_access_requests` table.
 *
 * The upgrade path is what is worth testing. A `:memory:` database starts at
 * version 0 and runs every step, so it proves the fresh path and nothing about
 * a database that already holds the shared documents these rows hang off.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v33-")), "portal.db");
}

/** A database stopped at exactly `upTo`, holding one shared document. */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
     VALUES ('d1', 'Plan', 'alice@example.com', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v32 -> v33", () => {
  it("adds the table to a populated database without disturbing what is there", () => {
    const file = tmpDbPath();
    seedAt(file, 32);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(33);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(33);
    expect(db.prepare(`SELECT title FROM shared_docs WHERE id = 'd1'`).get()).toEqual({ title: "Plan" });
    expect(listPending(db, "d1")).toEqual([]);
    db.close();
  });

  it("holds one pending ask per person per document, and keeps decided ones", () => {
    const file = tmpDbPath();
    seedAt(file, 32);
    const db = openDb(file);

    requestAccess(db, { docId: "d1", requesterEmail: "bob@example.com", access: "view", message: null });
    requestAccess(db, { docId: "d1", requesterEmail: "bob@example.com", access: "edit", message: null });
    expect(listPending(db, "d1")).toHaveLength(1);

    db.prepare(`UPDATE doc_access_requests SET status = 'declined' WHERE doc_id = 'd1'`).run();
    requestAccess(db, { docId: "d1", requesterEmail: "bob@example.com", access: "view", message: null });
    expect(listPending(db, "d1")).toHaveLength(1);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM doc_access_requests`).get(),
    ).toEqual({ n: 2 });
    db.close();
  });

  it("refuses a level outside the three the ACL knows", () => {
    const file = tmpDbPath();
    seedAt(file, 32);
    const db = openDb(file);

    expect(() =>
      db.prepare(
        `INSERT INTO doc_access_requests (id, doc_id, requester_email, access, message, status, created_at)
         VALUES ('r1', 'd1', 'bob@example.com', 'owner', NULL, 'pending', '2026-08-23T00:00:00Z')`,
      ).run()).toThrow();
    db.close();
  });
});
