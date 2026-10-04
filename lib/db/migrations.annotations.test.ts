import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc, addComment } from "./shared-docs";
import { backfillFlatComments } from "./migrations";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=@n`).get({ n: name });
}

interface ThreadRow {
  status: string;
  anchor_json: string | null;
}
interface MessageRow {
  body: string;
  author_email: string;
}

describe("v16 annotations migration", () => {
  it("creates the three annotation tables", () => {
    expect(tableExists("doc_comment_threads")).toBe(true);
    expect(tableExists("doc_comment_messages")).toBe(true);
    expect(tableExists("doc_suggestions")).toBe(true);
  });

  it("backfills existing flat comments into open general threads", () => {
    // openDb runs all migrations including the backfill; to observe it we insert a
    // flat comment through the legacy path and re-run the backfill idempotently.
    insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: "a@x.com", body: "# b" }, "2026-07-11T00:00:00.000Z");
    addComment(db, { id: "c1", docId: "d1", authorEmail: "a@x.com", body: "legacy note", anchor: null });
    // Simulate an upgrade over pre-existing data by invoking the backfill helper again.
    backfillFlatComments(db);
    const thread = db.prepare(`SELECT * FROM doc_comment_threads WHERE id='c1'`).get() as ThreadRow;
    const msg = db.prepare(`SELECT * FROM doc_comment_messages WHERE thread_id='c1'`).get() as MessageRow;
    expect(thread.status).toBe("open");
    expect(thread.anchor_json).toBeNull();
    expect(msg.body).toBe("legacy note");
    expect(msg.author_email).toBe("a@x.com");
  });
});
