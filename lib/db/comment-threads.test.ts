import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc } from "./shared-docs";
import { createThread, addReply, setThreadStatus, listThreads } from "./comment-threads";
import type { TextAnchor } from "@/lib/shared-docs/types";

let db: DatabaseType;
const A: TextAnchor = { quote: "brown fox", prefix: "quick ", suffix: " jumps", start: 10 };

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: "a@x.com", body: "# b" }, "2026-07-11T00:00:00.000Z");
  insertSharedDoc(db, { id: "d2", title: "Q", ownerEmail: "a@x.com", body: "# c" }, "2026-07-11T00:00:00.000Z");
});

describe("comment threads", () => {
  it("creates a thread with its first message and reads it back", () => {
    createThread(db, {
      id: "t1", docId: "d1", anchor: A, createdBy: "a@x.com",
      createdAt: "2026-07-11T00:01:00.000Z", body: "why this phrasing?", messageId: "m1",
    });
    const threads = listThreads(db, "d1");
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor).toEqual(A);
    expect(threads[0].status).toBe("open");
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].body).toBe("why this phrasing?");
  });

  it("stores a null anchor as a general thread", () => {
    createThread(db, {
      id: "t2", docId: "d1", anchor: null, createdBy: "a@x.com",
      createdAt: "2026-07-11T00:02:00.000Z", body: "overall LGTM", messageId: "m2",
    });
    expect(listThreads(db, "d1")[0].anchor).toBeNull();
  });

  it("appends replies oldest-first", () => {
    createThread(db, { id: "t1", docId: "d1", anchor: null, createdBy: "a@x.com", createdAt: "2026-07-11T00:01:00.000Z", body: "one", messageId: "m1" });
    addReply(db, { id: "m2", threadId: "t1", docId: "d1", authorEmail: "b@x.com", body: "two", createdAt: "2026-07-11T00:03:00.000Z" });
    const msgs = listThreads(db, "d1")[0].messages;
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("resolves and reopens", () => {
    createThread(db, { id: "t1", docId: "d1", anchor: null, createdBy: "a@x.com", createdAt: "2026-07-11T00:01:00.000Z", body: "one", messageId: "m1" });
    expect(setThreadStatus(db, "t1", "d1", "resolved", "b@x.com", "2026-07-11T00:05:00.000Z")).toBe(true);
    let t = listThreads(db, "d1")[0];
    expect(t.status).toBe("resolved");
    expect(t.resolvedBy).toBe("b@x.com");
    setThreadStatus(db, "t1", "d1", "open", null, "2026-07-11T00:06:00.000Z");
    t = listThreads(db, "d1")[0];
    expect(t.status).toBe("open");
    expect(t.resolvedBy).toBeNull();
  });

  it("does not reply to a thread that belongs to a different document", () => {
    createThread(db, { id: "t2", docId: "d2", anchor: null, createdBy: "a@x.com", createdAt: "2026-07-11T00:01:00.000Z", body: "d2 thread", messageId: "m1" });
    const ok = addReply(db, { id: "m2", threadId: "t2", docId: "d1", authorEmail: "b@x.com", body: "cross-doc reply", createdAt: "2026-07-11T00:03:00.000Z" });
    expect(ok).toBe(false);
    expect(listThreads(db, "d2")[0].messages).toHaveLength(1);
  });

  it("does not resolve a thread that belongs to a different document", () => {
    createThread(db, { id: "t2", docId: "d2", anchor: null, createdBy: "a@x.com", createdAt: "2026-07-11T00:01:00.000Z", body: "d2 thread", messageId: "m1" });
    const ok = setThreadStatus(db, "t2", "d1", "resolved", "b@x.com", "2026-07-11T00:05:00.000Z");
    expect(ok).toBe(false);
    expect(listThreads(db, "d2")[0].status).toBe("open");
  });
});
