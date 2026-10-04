import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { getArtifactForOwner, markPublished, listArtifactsForOwner } from "./artifacts";

/**
 * v20 -> v21 (artifact `in_review`): the artifacts table is rebuilt so an `mr`
 * publish can record "proposed but not merged" instead of claiming published.
 * SQLite cannot ALTER a CHECK constraint, so this drops and recreates the
 * table. That is the risk worth a test: build a DB at the pre-final schema,
 * seed rows in every pre-existing status plus a version row, then open it
 * (which runs only the new final step) and assert nothing was lost.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v21-")), "portal.db");
}

const OWNER = "alice@example.com";

/**
 * Build a database stopped at exactly `upTo`, then let `openDb` run the rest.
 *
 * Explicit rather than `MIGRATIONS.length - 1`: that idiom silently re-aims at a
 * different step every time a migration is appended, which is how the v21 test
 * quietly stopped testing v21. Version numbers here are the point of the test.
 */
function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  const insert = db.prepare(
    `INSERT INTO artifacts (id, title, owner_email, source_thread_id, status, target_path,
       target_visibility, published_note_path, created_at, updated_at)
     VALUES (@id, @title, @owner, @thread, @status, @path, @vis, @note, @at, @at)`,
  );
  insert.run({ id: "a-draft", title: "Draft one", owner: OWNER, thread: "t1", status: "draft",
    path: null, vis: null, note: null, at: "2026-07-01T00:00:00Z" });
  insert.run({ id: "a-ready", title: "Ready one", owner: OWNER, thread: null, status: "ready",
    path: "docs/notes/r.md", vis: '["exec"]', note: null, at: "2026-07-02T00:00:00Z" });
  insert.run({ id: "a-pub", title: "Published one", owner: OWNER, thread: "t2", status: "published",
    path: "docs/notes/p.md", vis: '["all-hands"]', note: "docs/notes/p.md", at: "2026-07-03T00:00:00Z" });

  db.prepare(
    `INSERT INTO artifact_versions (artifact_id, version, body, created_at)
     VALUES ('a-pub', 1, 'body text', '2026-07-03T00:00:00Z')`,
  ).run();
  db.close();
}

// v20 is the last version before the artifacts table was rebuilt.
const BEFORE_REBUILD = 20;
// v22 is where a database that ran the ORIGINAL v21 and v22 comes to rest. Real
// developer databases sat here, which is why the merge request columns had to
// arrive in their own additive step rather than as an edit to v21.
const BEFORE_MR_COLUMNS = 22;

describe("v20 -> v21 artifacts in_review", () => {
  it("carries every row and version through the table rebuild", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);

    const db = openDb(file);

    const draft = getArtifactForOwner(db, "a-draft", OWNER);
    const ready = getArtifactForOwner(db, "a-ready", OWNER);
    const published = getArtifactForOwner(db, "a-pub", OWNER);

    expect(draft?.status).toBe("draft");
    expect(ready?.status).toBe("ready");
    expect(ready?.targetVisibility).toEqual(["exec"]);
    expect(published?.status).toBe("published");
    expect(published?.publishedNotePath).toBe("docs/notes/p.md");
    expect(published?.sourceThreadId).toBe("t2");

    // The child table's rows must outlive the parent's rebuild.
    const versions = db
      .prepare("SELECT version, body FROM artifact_versions WHERE artifact_id = 'a-pub'")
      .all() as Array<{ version: number; body: string }>;
    expect(versions).toEqual([{ version: 1, body: "body text" }]);

    // The index is recreated, so the owner listing still works.
    expect(listArtifactsForOwner(db, OWNER).map((a) => a.id).sort()).toEqual(["a-draft", "a-pub", "a-ready"]);
  });

  it("accepts the new in_review status the widened CHECK exists for", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);
    const db = openDb(file);

    expect(markPublished(db, "a-ready", OWNER, "docs/notes/r.md", "in_review")).toBe(true);
    expect(getArtifactForOwner(db, "a-ready", OWNER)?.status).toBe("in_review");
  });

  // Codex review: backfillDocuments() copies an artifact's status straight into
  // document_publications, whose CHECK still only knew the old three. Backfilling
  // an in_review artifact would have thrown and rolled back the whole import.
  it("lets document_publications hold in_review too, so the backfill cannot throw", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);
    const db = openDb(file);

    db.prepare(
      `INSERT INTO documents (id, owner_email, title, current_version, created_at, updated_at)
       VALUES ('d1', @owner, 'Doc', 1, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
    ).run({ owner: OWNER });

    expect(() =>
      db.prepare(
        `INSERT INTO document_publications (doc_id, status, created_at, updated_at)
         VALUES ('d1', 'in_review', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
      ).run(),
    ).not.toThrow();
  });

  // The url is what the reader clicks; the iid is what the reconciler queries.
  it("records the merge request url and iid, so review is both reachable and reconcilable", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);
    const db = openDb(file);

    markPublished(db, "a-ready", OWNER, "docs/notes/r.md", "in_review", { url: "https://gl/mr/7", iid: 7 });
    const row = getArtifactForOwner(db, "a-ready", OWNER);
    expect(row?.status).toBe("in_review");
    expect(row?.mrUrl).toBe("https://gl/mr/7");
    expect(row?.mrIid).toBe(7);
  });

  it("leaves both merge request fields null for a direct publish, which opened none", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);
    const db = openDb(file);

    markPublished(db, "a-ready", OWNER, "docs/notes/r.md", "published");
    const row = getArtifactForOwner(db, "a-ready", OWNER);
    expect(row?.mrUrl).toBeNull();
    expect(row?.mrIid).toBeNull();
  });

  it("still refuses a status outside the allowed set", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_REBUILD);
    const db = openDb(file);

    expect(() =>
      db.prepare("UPDATE artifacts SET status = 'bogus' WHERE id = 'a-draft'").run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe("v22 -> v23 merge request columns", () => {
  // The regression this migration exists for: the columns were first added by
  // editing the v21 rebuild, and `migrate()` only runs steps ABOVE the stored
  // user_version. Every database that had already run v21 (every developer's)
  // was therefore left permanently without them, and the next MR publish would
  // fail with `no such column` AFTER having created the merge request.
  it("adds mr_url and mr_iid to a database that already ran v21 and v22", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_MR_COLUMNS);

    const before = new Database(file);
    const beforeCols = (before.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(beforeCols).not.toContain("mr_url");
    expect(beforeCols).not.toContain("mr_iid");
    before.close();

    const db = openDb(file);
    const cols = (db.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain("mr_url");
    expect(cols).toContain("mr_iid");
  });

  it("leaves the columns usable, and null, on rows that predate them", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_MR_COLUMNS);
    const seeded = new Database(file);
    seeded.prepare(
      `INSERT INTO artifacts (id, title, owner_email, status, created_at, updated_at)
       VALUES ('old', 'Old', @owner, 'ready', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`,
    ).run({ owner: OWNER });
    seeded.close();

    const db = openDb(file);
    const row = getArtifactForOwner(db, "old", OWNER);
    expect(row?.mrUrl).toBeNull();
    expect(row?.mrIid).toBeNull();
    expect(markPublished(db, "old", OWNER, "docs/x.md", "in_review", { url: "https://gl/mr/3", iid: 3 })).toBe(true);
    expect(getArtifactForOwner(db, "old", OWNER)?.mrIid).toBe(3);
  });
});

