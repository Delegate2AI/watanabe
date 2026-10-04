import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

/**
 * v29 -> v30 (`format` on every version table): a document version records
 * whether its body is markdown or HTML, so a version written as a designed page
 * is not rendered through the markdown pipeline and shown as literal tag soup.
 *
 * This is an ADD COLUMN with a CHECK rather than a table rebuild, which is the
 * property worth a test: a rebuild of `chat_documents` or `artifacts` would
 * cascade their version rows away (foreign keys are on in better-sqlite3), and
 * the whole reason for the additive shape is that it cannot. So the test seeds
 * real rows at the pre-final schema and asserts they arrive intact with the
 * correct default, and that the CHECK is live on later writes.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v30-")), "portal.db");
}

/** The last version before `format` was added. Explicit: see migrations-artifacts.test.ts. */
const BEFORE_FORMAT = 29;

const AT = "2026-08-01T00:00:00Z";

function seedAt(file: string, upTo: number): void {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);

  db.prepare(
    `INSERT INTO chat_documents (id, thread_id, owner_email, title, current_version, created_at, updated_at)
     VALUES ('cd1', 't1', 'alice@example.com', 'Chat doc', 1, @at, @at)`,
  ).run({ at: AT });
  db.prepare(
    `INSERT INTO chat_document_versions (doc_id, version, body, created_at)
     VALUES ('cd1', 1, '# heading', @at)`,
  ).run({ at: AT });

  db.prepare(
    `INSERT INTO documents (id, owner_email, title, current_version, origin_thread_id, created_at, updated_at)
     VALUES ('d1', 'alice@example.com', 'Shared doc', 1, NULL, @at, @at)`,
  ).run({ at: AT });
  db.prepare(
    `INSERT INTO document_versions (doc_id, version, body, author_email, created_at)
     VALUES ('d1', 1, 'shared body', 'alice@example.com', @at)`,
  ).run({ at: AT });

  db.prepare(
    `INSERT INTO artifacts (id, title, owner_email, source_thread_id, status, target_path,
       target_visibility, published_note_path, created_at, updated_at)
     VALUES ('a1', 'Artifact', 'alice@example.com', NULL, 'draft', NULL, NULL, NULL, @at, @at)`,
  ).run({ at: AT });
  db.prepare(
    `INSERT INTO artifact_versions (artifact_id, version, body, created_at)
     VALUES ('a1', 1, 'artifact body', @at)`,
  ).run({ at: AT });

  db.prepare(
    `INSERT INTO shared_docs (id, owner_email, title, created_at, updated_at)
     VALUES ('s1', 'alice@example.com', 'Shared', @at, @at)`,
  ).run({ at: AT });
  db.prepare(
    `INSERT INTO shared_doc_versions (doc_id, version, body, author_email, created_at)
     VALUES ('s1', 1, 'shared doc body', 'alice@example.com', @at)`,
  ).run({ at: AT });

  db.close();
}

/**
 * All four, not three. `shared_doc_versions` is a separate table from
 * `document_versions`, and a chat document promoted to a shared doc lands in it:
 * leaving it out would make promotion the one path where an HTML body silently
 * becomes a markdown one.
 */
const VERSION_TABLES = [
  "chat_document_versions",
  "document_versions",
  "artifact_versions",
  "shared_doc_versions",
] as const;

describe("v29 -> v30 document format", () => {
  it("adds the column to every version table", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_FORMAT);
    const db = openDb(file);

    for (const table of VERSION_TABLES) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(columns, `${table} has no format column`).toContain("format");
    }
  });

  it("leaves every row that existed before it as markdown, and loses none of them", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_FORMAT);
    const db = openDb(file);

    expect(db.prepare(`SELECT body, format FROM chat_document_versions WHERE doc_id = 'cd1'`).get())
      .toEqual({ body: "# heading", format: "md" });
    expect(db.prepare(`SELECT body, format FROM document_versions WHERE doc_id = 'd1'`).get())
      .toEqual({ body: "shared body", format: "md" });
    expect(db.prepare(`SELECT body, format FROM artifact_versions WHERE artifact_id = 'a1'`).get())
      .toEqual({ body: "artifact body", format: "md" });
    expect(db.prepare(`SELECT body, format FROM shared_doc_versions WHERE doc_id = 's1'`).get())
      .toEqual({ body: "shared doc body", format: "md" });
  });

  it("accepts html on a later write and refuses anything else", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_FORMAT);
    const db = openDb(file);

    db.prepare(
      `INSERT INTO chat_document_versions (doc_id, version, body, format, created_at)
       VALUES ('cd1', 2, '<h1>heading</h1>', 'html', @at)`,
    ).run({ at: AT });
    expect(db.prepare(`SELECT format FROM chat_document_versions WHERE version = 2`).get())
      .toEqual({ format: "html" });

    expect(() =>
      db.prepare(
        `INSERT INTO chat_document_versions (doc_id, version, body, format, created_at)
         VALUES ('cd1', 3, 'body', 'pdf', @at)`,
      ).run({ at: AT }),
    ).toThrow();
  });

  it("keeps the version rows, which a table rebuild would have cascaded away", () => {
    const file = tmpDbPath();
    seedAt(file, BEFORE_FORMAT);
    const db = openDb(file);

    for (const table of VERSION_TABLES) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(n, `${table} lost its rows`).toBe(1);
    }
  });
});
