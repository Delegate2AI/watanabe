import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { getPublication, recordPublication } from "./shared-doc-publications";

/**
 * v26 -> v27 (publishing a shared doc): the new `shared_doc_publications` table.
 *
 * The risk worth testing is the UPGRADE path. A `:memory:` database always
 * starts at version 0 and runs every step in order, so it proves the fresh path
 * and nothing about a database that already holds documents and shares.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v27-")), "portal.db");
}

const OWNER = "alice@example.com";

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 26 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
 * different step every time a migration is appended, which is how an earlier
 * test quietly stopped testing the step it was named after.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  db.prepare(
    `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
     VALUES (@id, @title, @owner, @at, @at)`,
  ).run({ id: "d1", title: "Onboarding", owner: OWNER, at: "2026-08-01T00:00:00Z" });
  db.prepare(
    `INSERT INTO shared_doc_versions (doc_id, version, body, author_email, created_at)
     VALUES ('d1', 1, 'The body.', @owner, @at)`,
  ).run({ owner: OWNER, at: "2026-08-01T00:00:00Z" });
  db.close();
}

describe("migration v26 -> v27", () => {
  it("adds the table to a populated database without disturbing what is there", () => {
    const file = tmpDbPath();
    seedAt(file, 26);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare(`SELECT title FROM shared_docs WHERE id = 'd1'`).get()).toEqual({ title: "Onboarding" });
    expect(db.prepare(`SELECT body FROM shared_doc_versions WHERE doc_id = 'd1'`).get()).toEqual({ body: "The body." });
    // A document that has never been published simply has no row, which is what
    // makes absence the answer rather than a nullable status column.
    expect(getPublication(db, "d1")).toBeNull();
    db.close();
  });

  it("stores a publication and replaces it on a later publish of the same document", () => {
    const file = tmpDbPath();
    seedAt(file, 26);
    const db = openDb(file);

    recordPublication(db, {
      docId: "d1",
      status: "in_review",
      targetPath: "handbook/onboarding.md",
      targetVisibility: ["all-hands"],
      mrUrl: "https://git/mr/1",
    });
    recordPublication(db, {
      docId: "d1",
      status: "published",
      targetPath: "handbook/onboarding.md",
      targetVisibility: ["exec"],
      publishedNotePath: "docs/handbook/onboarding.md",
    });

    const publication = getPublication(db, "d1");
    expect(publication?.status).toBe("published");
    expect(publication?.targetVisibility).toEqual(["exec"]);
    expect(publication?.mrUrl).toBeNull();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM shared_doc_publications`).get()).toEqual({ n: 1 });
    db.close();
  });

  it("takes the publication row with the document, leaving no orphan behind", () => {
    const file = tmpDbPath();
    seedAt(file, 26);
    const db = openDb(file);
    recordPublication(db, {
      docId: "d1",
      status: "in_review",
      targetPath: "handbook/onboarding.md",
      targetVisibility: ["all-hands"],
    });

    db.prepare(`DELETE FROM shared_docs WHERE id = 'd1'`).run();

    // better-sqlite3 runs with foreign keys ON, so this cascade is real and not
    // merely declared.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM shared_doc_publications`).get()).toEqual({ n: 0 });
    db.close();
  });

  it("refuses a status outside the two the flow can produce", () => {
    const file = tmpDbPath();
    seedAt(file, 26);
    const db = openDb(file);

    expect(() =>
      db
        .prepare(
          `INSERT INTO shared_doc_publications
             (doc_id, status, target_path, target_visibility, created_at, updated_at)
           VALUES ('d1', 'ready', 'a.md', '[]', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    db.close();
  });
});
