import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertVersion, listVersions, nextVersion } from "./version-store";

const BASIC_STORE = {
  table: "test_document_versions",
  fkColumn: "document_id",
} as const;

const AUTHORED_STORE = {
  table: "test_authored_versions",
  fkColumn: "document_id",
  extraColumns: ["author_email"],
} as const;

interface VersionRow {
  version: number;
  body: string;
  created_at: string;
}

interface AuthoredVersionRow extends VersionRow {
  author_email: string;
}

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  db.exec(`
    CREATE TABLE test_document_versions (
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE test_authored_versions (
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      body TEXT NOT NULL,
      author_email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
});

describe("version store", () => {
  it("starts version numbering at 1 and increments from the current maximum", () => {
    expect(nextVersion(db, BASIC_STORE, "doc-1")).toBe(1);
    insertVersion(db, BASIC_STORE, {
      id: "doc-1",
      version: 1,
      body: "first",
      createdAt: "2026-07-12T00:00:00.000Z",
    });
    expect(nextVersion(db, BASIC_STORE, "doc-1")).toBe(2);
    expect(nextVersion(db, BASIC_STORE, "doc-2")).toBe(1);
  });

  it("round-trips inserted versions in ascending version order", () => {
    insertVersion(db, BASIC_STORE, {
      id: "doc-1",
      version: 2,
      body: "second",
      createdAt: "2026-07-12T01:00:00.000Z",
    });
    insertVersion(db, BASIC_STORE, {
      id: "doc-1",
      version: 1,
      body: "first",
      createdAt: "2026-07-12T00:00:00.000Z",
    });

    expect(
      listVersions<VersionRow>(db, BASIC_STORE, "doc-1", ["version", "body", "created_at"] as const),
    ).toEqual([
      { version: 1, body: "first", created_at: "2026-07-12T00:00:00.000Z" },
      { version: 2, body: "second", created_at: "2026-07-12T01:00:00.000Z" },
    ]);
  });

  it("round-trips a configured extra column", () => {
    insertVersion(db, AUTHORED_STORE, {
      id: "doc-1",
      version: 1,
      body: "authored body",
      createdAt: "2026-07-12T00:00:00.000Z",
      extra: { author_email: "alice@example.com" },
    });

    expect(
      listVersions<AuthoredVersionRow>(db, AUTHORED_STORE, "doc-1", [
        "version",
        "body",
        "author_email",
        "created_at",
      ] as const),
    ).toEqual([
      {
        version: 1,
        body: "authored body",
        author_email: "alice@example.com",
        created_at: "2026-07-12T00:00:00.000Z",
      },
    ]);
  });
});
