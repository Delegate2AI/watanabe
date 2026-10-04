import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { addLink, createDocument, upsertShare } from "./store";
import {
  accessFor,
  accessForToken,
  canComment,
  canEdit,
  canManage,
  canRead,
  type EffectiveAccess,
} from "./access";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  createDocument(db, {
    id: "d1",
    ownerEmail: "alice@example.com",
    title: "Plan",
    body: "# body",
    originThreadId: null,
  });
});

describe("accessFor", () => {
  it("returns owner for the owner and the exact level for a recipient", () => {
    upsertShare(db, "d1", "bob@example.com", "comment");
    expect(accessFor(db, "d1", "alice@example.com")).toBe("owner");
    expect(accessFor(db, "d1", "bob@example.com")).toBe("comment");
  });

  it("returns none identically for a stranger and an unknown document", () => {
    expect(accessFor(db, "d1", "stranger@example.com")).toBe("none");
    expect(accessFor(db, "missing", "alice@example.com")).toBe("none");
  });

  it("lets ownership outrank an accidental lesser share", () => {
    upsertShare(db, "d1", "alice@example.com", "view");
    expect(accessFor(db, "d1", "alice@example.com")).toBe("owner");
  });
});

describe("accessForToken", () => {
  it("resolves an unexpired document link", () => {
    addLink(db, { token: "live", docId: "d1", access: "comment", expiresAt: null });
    expect(accessForToken(db, "live")).toEqual({ docId: "d1", access: "comment" });
  });

  it("returns null for unknown and expired links", () => {
    addLink(db, {
      token: "old",
      docId: "d1",
      access: "view",
      expiresAt: "2026-07-11T00:00:00.000Z",
    });
    expect(accessForToken(db, "missing", "2026-07-12T00:00:00.000Z")).toBeNull();
    expect(accessForToken(db, "old", "2026-07-12T00:00:00.000Z")).toBeNull();
  });
});

describe("capability matrix", () => {
  const cases: Array<[EffectiveAccess, boolean, boolean, boolean, boolean]> = [
    ["owner", true, true, true, true],
    ["edit", true, true, true, false],
    ["comment", true, true, false, false],
    ["view", true, false, false, false],
    ["none", false, false, false, false],
  ];

  it.each(cases)("%s has the expected capabilities", (access, read, comment, edit, manage) => {
    expect(canRead(access)).toBe(read);
    expect(canComment(access)).toBe(comment);
    expect(canEdit(access)).toBe(edit);
    expect(canManage(access)).toBe(manage);
  });
});
