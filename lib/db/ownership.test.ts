import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordThread } from "./threads";
import { checkOwnership, isOwnedBy } from "./ownership";

// The direct, non-eyeballed test of the resume-ownership-check logic every
// content-bearing route (app/api/agent, app/api/agent/sessions) relies on.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  recordThread(db, "alice-thread", "alice@x.com", "alice's chat");
});

describe("checkOwnership", () => {
  it('returns "own" when the requester owns the thread', () => {
    expect(checkOwnership(db, "alice-thread", "alice@x.com")).toBe("own");
  });

  it('(d) returns "forbidden" when a different requester (bob) claims alice\'s thread', () => {
    expect(checkOwnership(db, "alice-thread", "bob@x.com")).toBe("forbidden");
  });

  it('returns "unowned" for a session id this store has never recorded', () => {
    expect(checkOwnership(db, "never-seen", "bob@x.com")).toBe("unowned");
  });
});

describe("isOwnedBy — strict variant for content-bearing endpoints", () => {
  it("is true only when the requester is the recorded owner", () => {
    expect(isOwnedBy(db, "alice-thread", "alice@x.com")).toBe(true);
  });

  it("(d) rejects bob resuming alice's session id", () => {
    expect(isOwnedBy(db, "alice-thread", "bob@x.com")).toBe(false);
  });

  it("rejects an unowned/unknown id too (unowned counts as forbidden for content routes)", () => {
    expect(isOwnedBy(db, "never-seen", "bob@x.com")).toBe(false);
  });
});
