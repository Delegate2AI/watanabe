import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { listShares, getShare, sharesForPrincipal, listSharedWith } from "./shared-doc-shares";

/**
 * v25 -> v26 (team sharing): `doc_shares` gains `recipient_kind`.
 *
 * The risk worth a test is the UPGRADE path, not the fresh one. A `:memory:`
 * database always starts at version 0 and runs every step in order, so it can
 * never catch a step that fails against real, already-populated data. Every
 * pre-existing share row is a person and must keep granting exactly what it
 * granted before, with no backfill UPDATE beyond the column default.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v26-")), "portal.db");
}

const OWNER = "alice@example.com";
const DANA = "dana@example.com";
const BOB = "bob@example.com";

/**
 * Build a database stopped at exactly `upTo`, then let `openDb` run the rest.
 * Explicit rather than `MIGRATIONS.length - 1`, which silently re-aims at a
 * different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  db.prepare(
    `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
     VALUES (@id, @title, @owner, @at, @at)`,
  ).run({ id: "d1", title: "Plan", owner: OWNER, at: "2026-08-01T00:00:00Z" });

  // The pre-v26 shape: no recipient_kind column at all.
  const insert = db.prepare(
    `INSERT INTO doc_shares (doc_id, recipient_email, access, created_at)
     VALUES (@doc, @who, @access, @at)`,
  );
  insert.run({ doc: "d1", who: DANA, access: "comment", at: "2026-08-01T00:00:01Z" });
  insert.run({ doc: "d1", who: BOB, access: "view", at: "2026-08-01T00:00:02Z" });
  db.close();
}

describe("migration v25 -> v26 (doc_shares.recipient_kind)", () => {
  it("adds the column and reads every existing row as a person grant", () => {
    const file = tmpDbPath();
    seedAt(file, 25);
    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const shares = listShares(db, "d1");
    expect(shares).toHaveLength(2);
    expect(shares.every((s) => s.recipientKind === "user")).toBe(true);
    expect(shares.map((s) => s.recipient).sort()).toEqual([BOB, DANA]);
    // The grants themselves are untouched: same people, same levels.
    expect(getShare(db, "d1", DANA)).toBe("comment");
    expect(getShare(db, "d1", BOB)).toBe("view");
    db.close();
  });

  it("keeps a migrated person grant resolving, and does not turn it into a group grant", () => {
    const file = tmpDbPath();
    seedAt(file, 25);
    const db = openDb(file);

    expect(sharesForPrincipal(db, "d1", DANA)).toEqual(["comment"]);
    // The critical negative: a migrated row is a USER row, so it must not match
    // on the group side even for someone whose clearance happens to contain a
    // string equal to that address.
    expect(sharesForPrincipal(db, "d1", "stranger@example.com", [DANA])).toEqual([]);
    expect(listSharedWith(db, "stranger@example.com", [DANA])).toEqual([]);
    db.close();
  });

  it("rejects a write with a bogus kind, so the CHECK is live after the ALTER", () => {
    const file = tmpDbPath();
    seedAt(file, 25);
    const db = openDb(file);
    expect(() =>
      db
        .prepare(
          `INSERT INTO doc_shares (doc_id, recipient_email, recipient_kind, access, created_at)
           VALUES ('d1', 'x', 'everyone', 'view', '2026-08-01T00:00:03Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
