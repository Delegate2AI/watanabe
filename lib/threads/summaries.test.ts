import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { recordThread, setThreadPinned } from "@/lib/db/threads";
import { threadSummaries } from "./summaries";

// The shell layout and `GET /api/threads` render the sidebar from this one
// mapping. If they ever disagreed, the server-rendered list would visibly change
// the moment a client refetch landed on top of it.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("threadSummaries", () => {
  it("shapes the owner's threads for the sidebar, newest first", () => {
    recordThread(db, "s-old", "nick@veodyn.com", "Older chat", "2026-08-01T00:00:00.000Z");
    recordThread(db, "s-new", "nick@veodyn.com", "Newer chat", "2026-08-05T00:00:00.000Z");

    expect(threadSummaries(db, "nick@veodyn.com")).toEqual([
      { id: "s-new", title: "Newer chat", updatedAt: "2026-08-05T00:00:00.000Z", pinned: false },
      { id: "s-old", title: "Older chat", updatedAt: "2026-08-01T00:00:00.000Z", pinned: false },
    ]);
  });

  it("carries the pinned flag the sidebar groups on", () => {
    recordThread(db, "s1", "nick@veodyn.com", "Pin me", "2026-08-05T00:00:00.000Z");
    setThreadPinned(db, "s1", "nick@veodyn.com", true);

    expect(threadSummaries(db, "nick@veodyn.com")[0]?.pinned).toBe(true);
  });

  it("omits a pre-minted thread that has no title yet", () => {
    recordThread(db, "s1", "nick@veodyn.com", undefined, "2026-08-05T00:00:00.000Z");

    expect(threadSummaries(db, "nick@veodyn.com")).toEqual([]);
  });

  it("shows the pre-minted thread once its first turn titles it", () => {
    recordThread(db, "s1", "nick@veodyn.com", undefined, "2026-08-05T00:00:00.000Z");
    recordThread(db, "s1", "nick@veodyn.com", "Points doctrine", "2026-08-05T00:00:05.000Z");

    expect(threadSummaries(db, "nick@veodyn.com").map((t) => t.title)).toEqual(["Points doctrine"]);
  });

  it("never surfaces another owner's threads", () => {
    recordThread(db, "mine", "nick@veodyn.com", "Mine", "2026-08-05T00:00:00.000Z");
    recordThread(db, "theirs", "someone@veodyn.com", "Theirs", "2026-08-05T00:00:00.000Z");

    expect(threadSummaries(db, "nick@veodyn.com").map((t) => t.id)).toEqual(["mine"]);
  });
});
