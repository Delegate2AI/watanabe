import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { bindDocThread, docForThread, latestThreadForDoc } from "./doc-threads";

/**
 * v33 -> v34 (doc copilot): the `doc_threads` binding table and the
 * `doc_suggestions.via` column.
 *
 * The upgrade path is what is worth testing. A `:memory:` database starts at
 * version 0 and runs every step, so it proves the fresh path and nothing about
 * a database that already holds shared documents and human suggestions.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v34-")), "portal.db");
}

/** A database stopped at exactly `upTo`, holding one doc and one pre-copilot suggestion. */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.prepare(
    `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
     VALUES ('d1', 'Plan', 'alice@example.com', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO doc_suggestions (id, doc_id, base_version, anchor_json, original_text, proposed_text, note, status, created_by, created_at)
     VALUES ('s1', 'd1', 1, '{}', 'old', 'new', NULL, 'pending', 'bob@example.com', '2026-08-02T00:00:00Z')`,
  ).run();
  db.close();
}

describe("migration v33 -> v34", () => {
  it("adds the binding table and column without disturbing what is there", () => {
    const file = tmpDbPath();
    seedAt(file, 33);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(34);
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(34);
    // A suggestion written before the column existed reads as human-authored.
    expect(db.prepare(`SELECT via FROM doc_suggestions WHERE id = 's1'`).get()).toEqual({ via: null });
    expect(docForThread(db, "t-none")).toBeNull();
    db.close();
  });

  it("binds threads to a doc, newest first, and cascades with the document", () => {
    const file = tmpDbPath();
    seedAt(file, 33);
    const db = openDb(file);

    bindDocThread(db, "t1", "d1", "bob@example.com", "2026-08-27T10:00:00Z");
    bindDocThread(db, "t2", "d1", "bob@example.com", "2026-08-27T11:00:00Z");
    expect(docForThread(db, "t1")).toEqual({ docId: "d1", ownerEmail: "bob@example.com" });
    expect(latestThreadForDoc(db, "d1", "bob@example.com")).toBe("t2");
    // Another user's binding never resumes as this user's panel thread.
    expect(latestThreadForDoc(db, "d1", "carol@example.com")).toBeNull();

    db.prepare(`DELETE FROM shared_docs WHERE id = 'd1'`).run();
    expect(docForThread(db, "t1")).toBeNull();
    db.close();
  });
});
