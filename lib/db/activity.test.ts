import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { getCursor, markSeen } from "./activity";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("activity cursor store", () => {
  it("reads a never-seen user as having seen nothing, and does not write on read", () => {
    // Stamping a cursor on first read would silently acknowledge everything
    // that happened before a new joiner arrived. Reading must not write.
    expect(getCursor(db, " Alice@Example.com ")).toBe("1970-01-01T00:00:00.000Z");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM activity_cursor").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("advances the cursor when the user marks activity seen", () => {
    const seenAt = "2026-07-11T13:00:00.000Z";
    expect(markSeen(db, "ALICE@example.com", seenAt)).toBe(seenAt);
    expect(getCursor(db, "alice@example.com")).toBe(seenAt);
  });
});
