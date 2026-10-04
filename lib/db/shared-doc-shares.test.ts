import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertSharedDoc } from "./shared-docs";
import { listShares, listSharedWith, upsertShare, removeShare, getShare } from "./shared-doc-shares";

/**
 * The team-sharing half of the `doc_shares` store. The person-only behaviour is
 * covered by `shared-docs.test.ts`; this file is about what a group row does and
 * about the places where a group row and a user row must NOT be confused.
 */

let db: DatabaseType;

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const T = "2026-08-11T00:00:01.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE, body: "# body" }, "2026-08-11T00:00:00.000Z");
});

describe("listSharedWith with team grants", () => {
  it("returns a doc shared with a team the reader is in", () => {
    upsertShare(db, "d1", "engineering", "comment", T, "group");
    const found = listSharedWith(db, BOB, ["all-hands", "engineering"]);
    expect(found.map((d) => d.id)).toEqual(["d1"]);
    expect(found[0].access).toBe("comment");
  });

  it("returns nothing for a team the reader is not in, and nothing without clearance", () => {
    upsertShare(db, "d1", "engineering", "edit", T, "group");
    expect(listSharedWith(db, BOB, ["all-hands"])).toEqual([]);
    expect(listSharedWith(db, BOB)).toEqual([]);
  });

  it("reports the HIGHEST access when a personal and a team grant overlap, once", () => {
    upsertShare(db, "d1", "engineering", "view", T, "group");
    upsertShare(db, "d1", BOB, "edit", T);
    const found = listSharedWith(db, BOB, ["engineering"]);
    // One row, not two: the doc is listed once at the best access it grants.
    expect(found).toHaveLength(1);
    expect(found[0].access).toBe("edit");
  });

  it("collapses two overlapping team grants to one row at the higher access", () => {
    upsertShare(db, "d1", "engineering", "view", T, "group");
    upsertShare(db, "d1", "exec", "comment", T, "group");
    const found = listSharedWith(db, BOB, ["engineering", "exec"]);
    expect(found).toHaveLength(1);
    expect(found[0].access).toBe("comment");
  });

  it("never lists the owner's OWN doc back to them through their own team", () => {
    // Newly possible with team sharing: Alice shares with a team she is in.
    upsertShare(db, "d1", "engineering", "edit", T, "group");
    expect(listSharedWith(db, ALICE, ["engineering"])).toEqual([]);
  });

  it("ignores an empty or blank clearance entry rather than matching a blank group", () => {
    upsertShare(db, "d1", "", "edit", T, "group");
    expect(listSharedWith(db, BOB, ["", "   "])).toEqual([]);
  });
});

describe("a group row and a user row are distinct rows", () => {
  it("getShare is scoped by kind", () => {
    upsertShare(db, "d1", "engineering", "edit", T, "group");
    expect(getShare(db, "d1", "engineering", "group")).toBe("edit");
    expect(getShare(db, "d1", "engineering", "user")).toBeNull();
  });

  it("revoking a team does not need it to still be a valid target", () => {
    upsertShare(db, "d1", "retired-team", "view", T, "group");
    expect(removeShare(db, "d1", "retired-team", "group")).toBe(true);
    expect(listShares(db, "d1")).toEqual([]);
  });

  it("revoking with the wrong kind removes nothing", () => {
    upsertShare(db, "d1", BOB, "view", T);
    expect(removeShare(db, "d1", BOB, "group")).toBe(false);
    expect(getShare(db, "d1", BOB)).toBe("view");
  });

  it("an upsert rewrites the kind rather than leaving a stale one", () => {
    upsertShare(db, "d1", "engineering", "view", T, "group");
    upsertShare(db, "d1", "engineering", "edit", T, "user");
    const rows = listShares(db, "d1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: "engineering", recipientKind: "user", access: "edit" });
  });

  it("lists teams before people so the broadest grants read first", () => {
    upsertShare(db, "d1", BOB, "view", T);
    upsertShare(db, "d1", "engineering", "view", T, "group");
    expect(listShares(db, "d1").map((s) => s.recipientKind)).toEqual(["group", "user"]);
  });
});
