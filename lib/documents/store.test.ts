import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import {
  addPublication,
  addVersion,
  createDocument,
  dispositionFor,
  getDocument,
  listVersions,
  removePublication,
  removeShare,
  upsertShare,
} from "./store";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("unified documents store", () => {
  it("creates a document and numbers appended versions through the shared helper", () => {
    createDocument(
      db,
      {
        id: "doc-1",
        ownerEmail: "alice@example.com",
        title: "Launch plan",
        body: "first",
        originThreadId: null,
      },
      "2026-07-12T10:00:00.000Z",
    );

    expect(addVersion(db, "doc-1", "alice@example.com", "second", { now: "2026-07-12T11:00:00.000Z" })).toBe(2);
    expect(addVersion(db, "doc-1", "bob@example.com", "third", { now: "2026-07-12T12:00:00.000Z" })).toBe(3);
    expect(getDocument(db, "doc-1")?.currentVersion).toBe(3);
    expect(listVersions(db, "doc-1")).toEqual([
      { version: 1, body: "first", format: "md", authorEmail: "alice@example.com", createdAt: "2026-07-12T10:00:00.000Z" },
      { version: 2, body: "second", format: "md", authorEmail: "alice@example.com", createdAt: "2026-07-12T11:00:00.000Z" },
      { version: 3, body: "third", format: "md", authorEmail: "bob@example.com", createdAt: "2026-07-12T12:00:00.000Z" },
    ]);
  });

  it("derives private, shared, published, and combined dispositions from facets", () => {
    createDocument(
      db,
      { id: "doc-1", ownerEmail: "alice@example.com", title: "Plan", body: "body", originThreadId: null },
      "2026-07-12T10:00:00.000Z",
    );

    expect(dispositionFor(db, "doc-1")).toEqual({ private: true, shared: false, published: false });

    upsertShare(db, "doc-1", "bob@example.com", "comment", "2026-07-12T10:01:00.000Z");
    expect(dispositionFor(db, "doc-1")).toEqual({ private: false, shared: true, published: false });

    removeShare(db, "doc-1", "bob@example.com");
    addPublication(
      db,
      {
        docId: "doc-1",
        status: "ready",
        targetPath: "docs/launch.md",
        targetVisibility: ["all-hands"],
        publishedNotePath: null,
      },
      "2026-07-12T10:02:00.000Z",
    );
    expect(dispositionFor(db, "doc-1")).toEqual({ private: false, shared: false, published: true });

    upsertShare(db, "doc-1", "bob@example.com", "edit", "2026-07-12T10:03:00.000Z");
    expect(dispositionFor(db, "doc-1")).toEqual({ private: false, shared: true, published: true });

    expect(removeShare(db, "doc-1", "bob@example.com")).toBe(true);
    expect(removePublication(db, "doc-1")).toBe(true);
    expect(dispositionFor(db, "doc-1")).toEqual({ private: true, shared: false, published: false });
  });
});
