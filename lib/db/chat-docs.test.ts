import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordThread } from "./threads";
import {
  createDoc,
  addVersion,
  getDocForOwner,
  getVersions,
  latestVersion,
  listForThread,
  recordPromotion,
  getPromotions,
} from "./chat-docs";

let db: DatabaseType;
const OWNER = "alice@example.com";
const OTHER = "bob@example.com";
const THREAD = "thread-1";

beforeEach(() => {
  db = openDb(":memory:");
  // Authority is source-thread ownership: OWNER owns THREAD.
  recordThread(db, THREAD, OWNER, "chat");
});

describe("chat-docs store (source-thread authority)", () => {
  it("createDoc seeds version 1 and getDocForOwner returns it for the thread owner", () => {
    expect(createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "Memo", body: "# Memo" })).toBe(true);
    const doc = getDocForOwner(db, "d1", OWNER);
    expect(doc).not.toBeNull();
    expect(doc!.currentVersion).toBe(1);
    expect(doc!.threadId).toBe(THREAD);
    expect(getVersions(db, "d1", OWNER).map((v) => v.body)).toEqual(["# Memo"]);
  });

  it("createDoc is fail-closed: it will not create against a thread the owner does not own", () => {
    // OTHER does not own THREAD, and "unknown-thread" has no owner at all.
    expect(createDoc(db, { id: "x", threadId: THREAD, ownerEmail: OTHER, title: "T", body: "b" })).toBe(false);
    expect(createDoc(db, { id: "y", threadId: "unknown-thread", ownerEmail: OWNER, title: "T", body: "b" })).toBe(false);
    expect(getDocForOwner(db, "x", OTHER)).toBeNull();
    expect(getDocForOwner(db, "y", OWNER)).toBeNull();
  });

  it("addVersion appends v2 for the thread owner and bumps current_version", () => {
    createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "Memo", body: "one" });
    expect(addVersion(db, "d1", OWNER, "two")).toBe(2);
    expect(getDocForOwner(db, "d1", OWNER)!.currentVersion).toBe(2);
    expect(latestVersion(db, "d1", OWNER)).toEqual({ version: 2, body: "two", format: "md" });
  });

  it("authority is the SOURCE THREAD, not the denormalized owner_email", () => {
    // Inject a divergent row: owner_email = OTHER, but its source thread is owned
    // by OWNER. The denormalized owner must NOT grant access; the thread owner does.
    db.prepare(
      `INSERT INTO chat_documents (id, thread_id, owner_email, title, current_version, created_at, updated_at)
       VALUES ('div', @thread, @other, 'Divergent', 1, '2026-07-11T00:00:00Z', '2026-07-11T00:00:00Z')`,
    ).run({ thread: THREAD, other: OTHER });
    db.prepare(
      `INSERT INTO chat_document_versions (doc_id, version, body, created_at)
       VALUES ('div', 1, 'secret', '2026-07-11T00:00:00Z')`,
    ).run();
    // The denormalized owner (OTHER) gets nothing; the source-thread owner (OWNER) gets it.
    expect(getDocForOwner(db, "div", OTHER)).toBeNull();
    expect(getVersions(db, "div", OTHER)).toEqual([]);
    expect(addVersion(db, "div", OTHER, "hack")).toBe(false);
    expect(getDocForOwner(db, "div", OWNER)!.id).toBe("div");
  });

  it("a foreign requester and an unknown id are indistinguishable (no oracle)", () => {
    createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "Memo", body: "one" });
    expect(getDocForOwner(db, "d1", OTHER)).toBeNull();
    expect(getDocForOwner(db, "nope", OWNER)).toBeNull();
    expect(getVersions(db, "d1", OTHER)).toEqual([]);
    expect(addVersion(db, "d1", OTHER, "hack")).toBe(false);
    expect(latestVersion(db, "d1", OTHER)).toBeNull();
  });

  it("listForThread is thread-owner scoped, newest first", () => {
    recordThread(db, "other-thread", OWNER, "chat2");
    createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "A", body: "a" }, "2026-07-11T00:00:00Z");
    createDoc(db, { id: "d2", threadId: THREAD, ownerEmail: OWNER, title: "B", body: "b" }, "2026-07-11T01:00:00Z");
    createDoc(db, { id: "d3", threadId: "other-thread", ownerEmail: OWNER, title: "C", body: "c" }, "2026-07-11T02:00:00Z");
    expect(listForThread(db, THREAD, OWNER).map((d) => d.id)).toEqual(["d2", "d1"]);
    // A requester who does not own the thread sees nothing.
    expect(listForThread(db, THREAD, OTHER)).toEqual([]);
  });

  it("recordPromotion upserts one row per target_type, scoped to the thread owner", () => {
    createDoc(db, { id: "d1", threadId: THREAD, ownerEmail: OWNER, title: "Memo", body: "one" });
    const p = (targetType: "artifact" | "shared_doc", targetId: string, promoted: number, at: number) =>
      recordPromotion(db, {
        docId: "d1",
        ownerEmail: OWNER,
        targetType,
        targetId,
        promotedVersion: promoted,
        targetVersionAtPromote: at,
      });
    expect(p("artifact", "art1", 1, 1)).toBe(true);
    expect(p("shared_doc", "sd1", 1, 1)).toBe(true);
    // A non-owner of the source thread cannot record a promotion.
    expect(
      recordPromotion(db, {
        docId: "d1",
        ownerEmail: OTHER,
        targetType: "artifact",
        targetId: "evil",
        promotedVersion: 9,
        targetVersionAtPromote: 9,
      }),
    ).toBe(false);

    expect(getPromotions(db, "d1", OWNER).map((x) => x.targetType).sort()).toEqual(["artifact", "shared_doc"]);
    // Update advances the same row.
    p("artifact", "art1", 2, 2);
    const artifact = getPromotions(db, "d1", OWNER).find((x) => x.targetType === "artifact")!;
    expect(getPromotions(db, "d1", OWNER)).toHaveLength(2);
    expect(artifact.promotedVersion).toBe(2);
    expect(artifact.targetVersionAtPromote).toBe(2);
    // A foreign requester sees no promotions.
    expect(getPromotions(db, "d1", OTHER)).toEqual([]);
  });
});
