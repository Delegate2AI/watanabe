import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc } from "./shared-docs";
import { bindDocThread, docForThread, latestThreadForDoc } from "./doc-threads";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: "alice@example.com", body: "b" });
  insertSharedDoc(db, { id: "d2", title: "Notes", ownerEmail: "alice@example.com", body: "b" });
});

describe("doc-threads", () => {
  it("binds and reads back a thread's document", () => {
    bindDocThread(db, "t1", "d1", "bob@example.com");
    expect(docForThread(db, "t1")).toEqual({ docId: "d1", ownerEmail: "bob@example.com" });
    expect(docForThread(db, "unknown")).toBeNull();
  });

  it("re-binding the same thread is an idempotent upsert", () => {
    bindDocThread(db, "t1", "d1", "bob@example.com", "2026-08-27T10:00:00Z");
    bindDocThread(db, "t1", "d1", "bob@example.com", "2026-08-27T12:00:00Z");
    expect(docForThread(db, "t1")).toEqual({ docId: "d1", ownerEmail: "bob@example.com" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM doc_threads`).get()).toEqual({ n: 1 });
  });

  it("resumes the newest of several threads per (doc, user)", () => {
    bindDocThread(db, "t1", "d1", "bob@example.com", "2026-08-27T10:00:00Z");
    bindDocThread(db, "t2", "d1", "bob@example.com", "2026-08-27T11:00:00Z");
    bindDocThread(db, "t3", "d2", "bob@example.com", "2026-08-27T12:00:00Z");
    expect(latestThreadForDoc(db, "d1", "bob@example.com")).toBe("t2");
    expect(latestThreadForDoc(db, "d2", "bob@example.com")).toBe("t3");
    expect(latestThreadForDoc(db, "d1", "carol@example.com")).toBeNull();
  });
});
