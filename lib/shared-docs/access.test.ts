import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc, upsertShare, insertLink } from "@/lib/db/shared-docs";
import {
  accessFor,
  accessForToken,
  canRead,
  canComment,
  canEdit,
  canManage,
  type EffectiveAccess,
} from "./access";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: "alice@example.com", body: "# body" }, "2026-07-11T00:00:00.000Z");
});

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const DANA = "dana@example.com";

describe("accessFor", () => {
  it("returns owner for the owner", () => {
    expect(accessFor(db, "d1", ALICE)).toBe("owner");
  });

  it("returns the exact share level for a named recipient", () => {
    upsertShare(db, "d1", BOB, "view", "2026-07-11T00:00:01.000Z");
    upsertShare(db, "d1", DANA, "comment", "2026-07-11T00:00:02.000Z");
    expect(accessFor(db, "d1", BOB)).toBe("view");
    expect(accessFor(db, "d1", DANA)).toBe("comment");
  });

  it("returns none for someone with no share (no oracle: same as an unknown doc)", () => {
    expect(accessFor(db, "d1", "stranger@example.com")).toBe("none");
    expect(accessFor(db, "unknown-doc", ALICE)).toBe("none");
  });

  it("owner beats any share row (highest wins)", () => {
    // Even if the owner somehow has a lesser share row, owner wins.
    upsertShare(db, "d1", ALICE, "view", "2026-07-11T00:00:01.000Z");
    expect(accessFor(db, "d1", ALICE)).toBe("owner");
  });
});

describe("accessForToken", () => {
  it("resolves an unexpired token to its doc and access", () => {
    insertLink(db, { token: "tok", docId: "d1", access: "comment", expiresAt: null }, "2026-07-11T00:00:01.000Z");
    expect(accessForToken(db, "tok")).toEqual({ docId: "d1", access: "comment" });
  });

  it("returns null for an unknown token", () => {
    expect(accessForToken(db, "nope")).toBeNull();
  });

  it("returns null for an expired token (same as invalid: no oracle)", () => {
    insertLink(db, { token: "old", docId: "d1", access: "view", expiresAt: "2026-07-10T00:00:00.000Z" }, "2026-07-09T00:00:00.000Z");
    expect(accessForToken(db, "old", "2026-07-11T00:00:00.000Z")).toBeNull();
    expect(accessForToken(db, "old", "2026-07-11T00:00:00.000Z")).toEqual(accessForToken(db, "nope"));
  });

  it("honors a future expiry", () => {
    insertLink(db, { token: "live", docId: "d1", access: "view", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-07-11T00:00:00.000Z");
    expect(accessForToken(db, "live", "2026-07-11T00:00:00.000Z")).toEqual({ docId: "d1", access: "view" });
  });
});

describe("capability matrix", () => {
  const cases: Array<[EffectiveAccess, boolean, boolean, boolean, boolean]> = [
    // access,   read,  comment, edit,  manage
    ["owner", true, true, true, true],
    ["edit", true, true, true, false],
    ["comment", true, true, false, false],
    ["view", true, false, false, false],
    ["none", false, false, false, false],
  ];
  it.each(cases)("%s -> read/comment/edit/manage", (access, read, comment, edit, manage) => {
    expect(canRead(access)).toBe(read);
    expect(canComment(access)).toBe(comment);
    expect(canEdit(access)).toBe(edit);
    expect(canManage(access)).toBe(manage);
  });

  it("a view-only principal can never comment or edit", () => {
    expect(canComment("view")).toBe(false);
    expect(canEdit("view")).toBe(false);
  });

  it("a comment principal can never edit", () => {
    expect(canEdit("comment")).toBe(false);
  });
});

describe("accessFor with team grants", () => {
  const T = "2026-07-11T00:00:01.000Z";
  const group = (recipient: string, access: "view" | "comment" | "edit") =>
    upsertShare(db, "d1", recipient, access, T, "group");

  it("grants through a team the reader is in", () => {
    group("engineering", "comment");
    expect(accessFor(db, "d1", BOB, ["all-hands", "engineering"])).toBe("comment");
  });

  it("does NOT grant on clearance alone: it takes an explicit row naming the team", () => {
    // Bob is cleared for engineering and the doc has no engineering grant.
    expect(accessFor(db, "d1", BOB, ["all-hands", "engineering"])).toBe("none");
    // And a grant to a team he is NOT in stays invisible to him.
    group("finance", "edit");
    expect(accessFor(db, "d1", BOB, ["all-hands", "engineering"])).toBe("none");
  });

  it("ignores team rows when no clearance is passed, so a caller fails closed", () => {
    group("engineering", "edit");
    expect(accessFor(db, "d1", BOB)).toBe("none");
  });

  it("takes the HIGHEST of a personal and a team grant, in either direction", () => {
    group("engineering", "view");
    upsertShare(db, "d1", BOB, "edit", T);
    expect(accessFor(db, "d1", BOB, ["engineering"])).toBe("edit");

    upsertShare(db, "d1", DANA, "view", T);
    upsertShare(db, "d1", "exec", "comment", T, "group");
    expect(accessFor(db, "d1", DANA, ["exec"])).toBe("comment");
  });

  it("takes the highest across two teams the reader is in", () => {
    group("engineering", "view");
    group("exec", "edit");
    expect(accessFor(db, "d1", BOB, ["engineering", "exec"])).toBe("edit");
  });

  it("keeps the owner the owner even when a team grant would say less", () => {
    group("engineering", "view");
    expect(accessFor(db, "d1", ALICE, ["engineering"])).toBe("owner");
  });

  it("a team grant follows membership: the same row stops granting once you leave", () => {
    group("engineering", "comment");
    expect(accessFor(db, "d1", BOB, ["engineering"])).toBe("comment");
    // No edit to the document; Bob simply is not in the team any more.
    expect(accessFor(db, "d1", BOB, ["all-hands"])).toBe("none");
  });

  it("does not confuse a team named like an address with the person", () => {
    // A group row whose key happens to equal an email must not grant that person.
    upsertShare(db, "d1", DANA, "edit", T, "group");
    expect(accessFor(db, "d1", DANA)).toBe("none");
    expect(accessFor(db, "d1", DANA, ["all-hands"])).toBe("none");
    // It grants only to whoever actually carries that key as clearance.
    expect(accessFor(db, "d1", BOB, [DANA])).toBe("edit");
  });

  it("still returns none on an unknown doc, clearance or not", () => {
    expect(accessFor(db, "unknown-doc", BOB, ["engineering"])).toBe("none");
  });
});
