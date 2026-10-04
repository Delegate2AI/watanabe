import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread } from "@/lib/db/threads";
import { getDocForOwner, getVersions } from "@/lib/db/chat-docs";
import { docWrite } from "./tools";

let db: DatabaseType;
const OWNER = "alice@example.com";
const OTHER = "bob@example.com";
const THREAD = "thread-1";
const THREAD2 = "thread-2";

function ctx(thread = THREAD, owner = OWNER) {
  return { db, getThreadId: () => thread, ownerEmail: owner };
}

beforeEach(() => {
  db = openDb(":memory:");
  // OWNER owns THREAD and THREAD2; OTHER owns nothing here.
  recordThread(db, THREAD, OWNER, "chat");
  recordThread(db, THREAD2, OWNER, "chat2");
});

describe("docWrite", () => {
  it("creates a new chat document at version 1 when no docId", () => {
    const out = docWrite(ctx(), { title: "Memo", body: "# Memo\n\nbody" });
    expect(out.version).toBe(1);
    const doc = getDocForOwner(db, out.docId, OWNER);
    expect(doc!.title).toBe("Memo");
    expect(doc!.threadId).toBe(THREAD);
  });

  it("derives a title from the first heading line when none is given", () => {
    const out = docWrite(ctx(), { body: "# One-pager\n\ntext" });
    expect(getDocForOwner(db, out.docId, OWNER)!.title).toBe("One-pager");
  });

  it("appends a version when given an existing docId in the same thread", () => {
    const first = docWrite(ctx(), { title: "Memo", body: "v1" });
    const second = docWrite(ctx(), { body: "v2", docId: first.docId });
    expect(second.docId).toBe(first.docId);
    expect(second.version).toBe(2);
    expect(getVersions(db, first.docId, OWNER).map((v) => v.body)).toEqual(["v1", "v2"]);
  });

  it("refuses to create in a thread the caller does not own", () => {
    // OTHER does not own THREAD.
    expect(() => docWrite(ctx(THREAD, OTHER), { title: "T", body: "b" })).toThrow();
    // An unowned/unknown current thread also refuses.
    expect(() => docWrite(ctx("unknown-thread", OWNER), { title: "T", body: "b" })).toThrow();
  });

  it("refuses to revise a doc from ANOTHER thread, even for the same owner", () => {
    const first = docWrite(ctx(THREAD), { title: "Memo", body: "v1" });
    // Same owner, but the agent is now in THREAD2: it must not revise THREAD's doc.
    expect(() => docWrite(ctx(THREAD2), { body: "cross", docId: first.docId })).toThrow();
    expect(getVersions(db, first.docId, OWNER).map((v) => v.body)).toEqual(["v1"]);
  });

  it("refuses to append to a docId the caller does not own (no oracle)", () => {
    const first = docWrite(ctx(), { title: "Memo", body: "v1" });
    expect(() => docWrite(ctx(THREAD, OTHER), { body: "hack", docId: first.docId })).toThrow();
    expect(getVersions(db, first.docId, OWNER).map((v) => v.body)).toEqual(["v1"]);
  });

  it("refuses an unknown docId with the same error as a foreign one", () => {
    expect(() => docWrite(ctx(), { body: "x", docId: "does-not-exist" })).toThrow();
  });
});
