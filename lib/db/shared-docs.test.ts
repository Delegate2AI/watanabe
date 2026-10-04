import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  insertSharedDoc,
  getSharedDoc,
  listSharedByOwner,
  listSharedWith,
  latestBody,
  getVersions,
  addVersion,
  getShare,
  listShares,
  upsertShare,
  removeShare,
  addComment,
  listComments,
  insertLink,
  getLink,
  listLinks,
  removeLink,
  deleteSharedDoc,
} from "./shared-docs";
import { createThread, listThreads } from "./comment-threads";
import { createSuggestion, listSuggestions } from "./suggestions";
import type { TextAnchor } from "@/lib/shared-docs/types";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const DANA = "dana@example.com";

function seed(id = "d1", owner = ALICE) {
  insertSharedDoc(
    db,
    { id, title: "Launch plan", ownerEmail: owner, body: "# v1 body" },
    "2026-07-11T00:00:00.000Z",
  );
}

describe("shared-docs store", () => {
  it("insert creates a doc with version 1 seeded from the body", () => {
    seed();
    const d = getSharedDoc(db, "d1");
    expect(d).not.toBeNull();
    expect(d?.title).toBe("Launch plan");
    expect(d?.ownerEmail).toBe(ALICE);
    expect(latestBody(db, "d1")).toBe("# v1 body");
    const versions = getVersions(db, "d1");
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].authorEmail).toBe(ALICE);
  });

  it("getSharedDoc returns null for an unknown id", () => {
    expect(getSharedDoc(db, "nope")).toBeNull();
  });

  it("listSharedByOwner returns only the owner's docs, newest first", () => {
    insertSharedDoc(db, { id: "d1", title: "One", ownerEmail: ALICE, body: "b1" }, "2026-07-11T00:00:00.000Z");
    insertSharedDoc(db, { id: "d2", title: "Two", ownerEmail: ALICE, body: "b2" }, "2026-07-11T00:00:02.000Z");
    insertSharedDoc(db, { id: "d3", title: "Bob", ownerEmail: BOB, body: "b3" }, "2026-07-11T00:00:01.000Z");
    expect(listSharedByOwner(db, ALICE).map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("versions: addVersion appends and advances latestBody; history retained", () => {
    seed();
    expect(addVersion(db, "d1", ALICE, "# v2", { now: "2026-07-11T01:00:00.000Z" })).toBe(2);
    expect(addVersion(db, "d1", DANA, "# v3", { now: "2026-07-11T02:00:00.000Z" })).toBe(3);
    expect(latestBody(db, "d1")).toBe("# v3");
    expect(getVersions(db, "d1").map((v) => v.version)).toEqual([1, 2, 3]);
    expect(getVersions(db, "d1")[2].authorEmail).toBe(DANA);
  });

  it("addVersion for an unknown doc returns false and writes nothing", () => {
    expect(addVersion(db, "ghost", ALICE, "# x")).toBe(false);
    expect(getVersions(db, "ghost")).toEqual([]);
  });

  it("shares: upsert adds and updates a recipient's access; getShare/listShares reflect it", () => {
    seed();
    upsertShare(db, "d1", DANA, "comment", "2026-07-11T00:00:01.000Z");
    expect(getShare(db, "d1", DANA)).toBe("comment");
    upsertShare(db, "d1", DANA, "edit", "2026-07-11T00:00:02.000Z");
    expect(getShare(db, "d1", DANA)).toBe("edit");
    upsertShare(db, "d1", BOB, "view", "2026-07-11T00:00:03.000Z");
    expect(listShares(db, "d1").map((s) => s.recipient).sort()).toEqual([BOB, DANA].sort());
  });

  it("getShare returns null for a recipient with no share row", () => {
    seed();
    expect(getShare(db, "d1", BOB)).toBeNull();
  });

  it("removeShare deletes the row and revokes access", () => {
    seed();
    upsertShare(db, "d1", DANA, "view", "2026-07-11T00:00:01.000Z");
    expect(removeShare(db, "d1", DANA)).toBe(true);
    expect(getShare(db, "d1", DANA)).toBeNull();
    expect(removeShare(db, "d1", DANA)).toBe(false);
  });

  it("listSharedWith returns docs shared with a recipient, carrying their access", () => {
    seed("d1", ALICE);
    insertSharedDoc(db, { id: "d2", title: "Other", ownerEmail: BOB, body: "b" }, "2026-07-11T00:00:05.000Z");
    upsertShare(db, "d1", DANA, "comment", "2026-07-11T00:00:01.000Z");
    upsertShare(db, "d2", DANA, "view", "2026-07-11T00:00:06.000Z");
    const list = listSharedWith(db, DANA);
    expect(list.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
    expect(list.find((d) => d.id === "d1")?.access).toBe("comment");
    // A doc with no share for DANA never appears.
    expect(listSharedWith(db, "nobody@example.com")).toEqual([]);
  });

  it("comments: add and list, ordered oldest first", () => {
    seed();
    addComment(db, { id: "c1", docId: "d1", authorEmail: DANA, body: "first", anchor: null }, "2026-07-11T00:00:01.000Z");
    addComment(db, { id: "c2", docId: "d1", authorEmail: ALICE, body: "reply", anchor: "para-2" }, "2026-07-11T00:00:02.000Z");
    const comments = listComments(db, "d1");
    expect(comments.map((c) => c.body)).toEqual(["first", "reply"]);
    expect(comments[1].anchor).toBe("para-2");
  });

  it("links: insert, get by token, list by doc, revoke (doc-scoped)", () => {
    seed();
    insertLink(db, { token: "tok-abc", docId: "d1", access: "view", expiresAt: null }, "2026-07-11T00:00:01.000Z");
    insertLink(db, { token: "tok-def", docId: "d1", access: "comment", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-07-11T00:00:02.000Z");
    const link = getLink(db, "tok-abc");
    expect(link?.docId).toBe("d1");
    expect(link?.access).toBe("view");
    expect(getLink(db, "unknown-token")).toBeNull();
    expect(listLinks(db, "d1").map((l) => l.token).sort()).toEqual(["tok-abc", "tok-def"]);
    expect(removeLink(db, "d1", "tok-abc")).toBe(true);
    expect(getLink(db, "tok-abc")).toBeNull();
    expect(removeLink(db, "d1", "tok-abc")).toBe(false);
  });

  it("removeLink is doc-scoped: doc A cannot revoke doc B's link even with B's token", () => {
    // Two owners, two docs, one external token each.
    insertSharedDoc(db, { id: "dA", title: "A", ownerEmail: ALICE, body: "a" }, "2026-07-11T00:00:00.000Z");
    insertSharedDoc(db, { id: "dB", title: "B", ownerEmail: BOB, body: "b" }, "2026-07-11T00:00:00.000Z");
    insertLink(db, { token: "tokB", docId: "dB", access: "view", expiresAt: null }, "2026-07-11T00:00:01.000Z");
    // Alice, acting on her doc dA, presents Bob's token for dB: no row matches.
    expect(removeLink(db, "dA", "tokB")).toBe(false);
    // Bob's link is untouched.
    expect(getLink(db, "tokB")?.docId).toBe("dB");
    // Scoped to the correct doc it revokes.
    expect(removeLink(db, "dB", "tokB")).toBe(true);
    expect(getLink(db, "tokB")).toBeNull();
  });

  it("deleteSharedDoc removes the doc and its children for the owner only", () => {
    // Deliberately OFF: deleteSharedDoc must not depend on the connection (or
    // this SQLite build's compile-time default) enabling FK enforcement --
    // every child row is deleted explicitly, regardless of that pragma.
    db.pragma("foreign_keys = OFF");
    seed();
    addVersion(db, "d1", ALICE, "# v2", { now: "2026-07-11T01:00:00.000Z" });
    upsertShare(db, "d1", DANA, "view", "2026-07-11T00:00:01.000Z");
    addComment(db, { id: "c1", docId: "d1", authorEmail: DANA, body: "x", anchor: null }, "2026-07-11T00:00:02.000Z");
    insertLink(db, { token: "t", docId: "d1", access: "view", expiresAt: null }, "2026-07-11T00:00:03.000Z");
    const anchor: TextAnchor = { quote: "v1", prefix: "# ", suffix: "", start: 2 };
    createThread(db, {
      id: "th1", docId: "d1", anchor, createdBy: DANA,
      createdAt: "2026-07-11T00:00:04.000Z", body: "why?", messageId: "msg1",
    });
    createSuggestion(db, {
      id: "sg1", docId: "d1", baseVersion: 1, anchor,
      originalText: "v1", proposedText: "v2", note: null,
      createdBy: DANA, createdAt: "2026-07-11T00:00:05.000Z",
    });
    // A non-owner cannot delete.
    expect(deleteSharedDoc(db, "d1", BOB)).toBe(false);
    expect(getSharedDoc(db, "d1")).not.toBeNull();
    // The owner can, and it cascades.
    expect(deleteSharedDoc(db, "d1", ALICE)).toBe(true);
    expect(getSharedDoc(db, "d1")).toBeNull();
    expect(getVersions(db, "d1")).toEqual([]);
    expect(listShares(db, "d1")).toEqual([]);
    expect(listComments(db, "d1")).toEqual([]);
    expect(listLinks(db, "d1")).toEqual([]);
    expect(listThreads(db, "d1")).toEqual([]);
    expect(listSuggestions(db, "d1")).toEqual([]);
    // Messages are only reachable via a join to their thread; check the raw
    // table directly so an orphaned row (thread gone, message left behind)
    // can't hide behind an empty listThreads() result.
    const orphanedMessages = db.prepare(`SELECT id FROM doc_comment_messages WHERE thread_id = @t`).all({ t: "th1" });
    expect(orphanedMessages).toEqual([]);
  });
});
