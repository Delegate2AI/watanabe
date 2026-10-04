import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc } from "./shared-docs";
import {
  requestAccess,
  getPending,
  getRequest,
  listPending,
  listPendingForOwner,
  decideRequest,
} from "./doc-access-requests";

let db: DatabaseType;

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const DANA = "dana@example.com";
const T0 = "2026-08-23T00:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE, body: "# body" }, T0);
  insertSharedDoc(db, { id: "d2", title: "Budget", ownerEmail: DANA, body: "# body" }, T0);
});

describe("requestAccess", () => {
  it("records a pending ask carrying the level and the message", () => {
    const created = requestAccess(
      db,
      { docId: "d1", requesterEmail: BOB, access: "comment", message: "for the review" },
      "2026-08-23T01:00:00.000Z",
    );
    expect(created.status).toBe("pending");
    expect(created.access).toBe("comment");
    expect(created.message).toBe("for the review");
    expect(getPending(db, "d1", BOB)?.id).toBe(created.id);
  });

  it("asking again updates the standing ask instead of queueing a second one", () => {
    requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, "2026-08-23T01:00:00.000Z");
    requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "edit", message: "actually" }, "2026-08-23T02:00:00.000Z");
    const pending = listPending(db, "d1");
    expect(pending).toHaveLength(1);
    expect(pending[0].access).toBe("edit");
    expect(pending[0].message).toBe("actually");
  });

  it("a decided ask does not block the same person asking again", () => {
    const first = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    expect(decideRequest(db, "d1", first.id, "declined", ALICE)).toBe(true);
    const second = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "edit", message: null }, T0);
    expect(second.id).not.toBe(first.id);
    expect(listPending(db, "d1")).toHaveLength(1);
    // The declined row is kept: a decision is an audit record, not a draft.
    expect(getRequest(db, "d1", first.id)?.status).toBe("declined");
  });

  it("cascades with the document", () => {
    requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    db.prepare("DELETE FROM shared_docs WHERE id = 'd1'").run();
    expect(listPending(db, "d1")).toEqual([]);
  });
});

describe("getRequest", () => {
  it("is scoped to its document, so an id alone cannot reach across documents", () => {
    const created = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    expect(getRequest(db, "d1", created.id)?.id).toBe(created.id);
    expect(getRequest(db, "d2", created.id)).toBeNull();
  });
});

describe("listPendingForOwner", () => {
  it("returns only asks on documents this person owns, with the title", () => {
    requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    requestAccess(db, { docId: "d2", requesterEmail: BOB, access: "view", message: null }, T0);
    const mine = listPendingForOwner(db, ALICE);
    expect(mine).toHaveLength(1);
    expect(mine[0].docId).toBe("d1");
    expect(mine[0].docTitle).toBe("Plan");
  });

  it("honours the since cursor and drops decided asks", () => {
    const old = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, "2026-08-23T01:00:00.000Z");
    requestAccess(db, { docId: "d1", requesterEmail: DANA, access: "view", message: null }, "2026-08-23T03:00:00.000Z");
    expect(listPendingForOwner(db, ALICE, "2026-08-23T02:00:00.000Z").map((r) => r.requesterEmail)).toEqual([DANA]);
    decideRequest(db, "d1", old.id, "granted", ALICE);
    expect(listPendingForOwner(db, ALICE).map((r) => r.requesterEmail)).toEqual([DANA]);
  });
});

describe("decideRequest", () => {
  it("stamps who decided and when, and refuses to decide twice", () => {
    const created = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    expect(decideRequest(db, "d1", created.id, "granted", ALICE, "2026-08-23T04:00:00.000Z")).toBe(true);
    const decided = getRequest(db, "d1", created.id);
    expect(decided?.status).toBe("granted");
    expect(decided?.decidedBy).toBe(ALICE);
    expect(decided?.decidedAt).toBe("2026-08-23T04:00:00.000Z");
    // A second decision changes nothing, so a stale panel cannot rewrite the first.
    expect(decideRequest(db, "d1", created.id, "declined", DANA)).toBe(false);
    expect(getRequest(db, "d1", created.id)?.decidedBy).toBe(ALICE);
  });

  it("refuses an id belonging to another document", () => {
    const created = requestAccess(db, { docId: "d1", requesterEmail: BOB, access: "view", message: null }, T0);
    expect(decideRequest(db, "d2", created.id, "granted", DANA)).toBe(false);
    expect(getRequest(db, "d1", created.id)?.status).toBe("pending");
  });
});
