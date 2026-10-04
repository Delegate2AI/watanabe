import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  recordThread,
  listThreadsForOwner,
  getThreadOwner,
  titleFrom,
  markDirty,
  listDirtyForOwner,
  markDreamed,
  isThreadDirty,
  setThreadPinned,
  setThreadTitle,
  deleteThread,
  getThreadModelChoice,
  setThreadModelChoice,
} from "./threads";

// The thread store is the single source of truth for "which threads exist and
// who owns them" — this is what makes per-user thread isolation real rather
// than assumed. Every test runs against a fresh in-memory DB.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("titleFrom", () => {
  it("truncates a long first prompt and trims whitespace", () => {
    expect(titleFrom("  Review the tokenomics doc  ")).toBe("Review the tokenomics doc");
    const long = "a".repeat(200);
    expect(titleFrom(long).length).toBe(80);
  });
  it("falls back when the prompt is empty/undefined", () => {
    expect(titleFrom("")).toBe("New chat");
    expect(titleFrom(undefined)).toBe("New chat");
  });
});

describe("recordThread", () => {
  it("creates a new thread with owner + title on first record", () => {
    recordThread(db, "s1", "alice@x.com", "what is the points doctrine", "2026-06-25T10:00:00Z");
    const owner = getThreadOwner(db, "s1");
    expect(owner).toBe("alice@x.com");
    const [row] = listThreadsForOwner(db, "alice@x.com");
    expect(row).toEqual({
      sdkSessionId: "s1",
      ownerEmail: "alice@x.com",
      title: "what is the points doctrine",
      createdAt: "2026-06-25T10:00:00Z",
      updatedAt: "2026-06-25T10:00:00Z",
      dirty: false,
      dreamedAt: null,
      pinned: false,
    });
  });

  it("bumps updatedAt on a later turn WITHOUT changing the title or createdAt (title omitted)", () => {
    recordThread(db, "s1", "alice@x.com", "first title", "2026-06-25T10:00:00Z");
    recordThread(db, "s1", "alice@x.com", undefined, "2026-06-25T11:30:00Z");
    const [row] = listThreadsForOwner(db, "alice@x.com");
    expect(row.title).toBe("first title");
    expect(row.createdAt).toBe("2026-06-25T10:00:00Z");
    expect(row.updatedAt).toBe("2026-06-25T11:30:00Z");
  });

  it("does not change the owner on a repeat record for the same id", () => {
    recordThread(db, "s1", "alice@x.com", "t", "2026-06-25T10:00:00Z");
    recordThread(db, "s1", "alice@x.com", undefined, "2026-06-25T11:00:00Z");
    expect(getThreadOwner(db, "s1")).toBe("alice@x.com");
  });
});

describe("listThreadsForOwner", () => {
  beforeEach(() => {
    recordThread(db, "a1", "alice@x.com", "alice thread 1", "2026-06-25T09:00:00Z");
    recordThread(db, "a2", "alice@x.com", "alice thread 2", "2026-06-25T12:00:00Z");
    recordThread(db, "b1", "bob@x.com", "bob thread 1", "2026-06-25T10:00:00Z");
  });

  it("(c) only returns threads for the given owner, not other owners' threads", () => {
    const aliceThreads = listThreadsForOwner(db, "alice@x.com").map((t) => t.sdkSessionId);
    expect(aliceThreads.sort()).toEqual(["a1", "a2"]);

    const bobThreads = listThreadsForOwner(db, "bob@x.com").map((t) => t.sdkSessionId);
    expect(bobThreads).toEqual(["b1"]);
  });

  it("orders by updatedAt, newest first", () => {
    const ids = listThreadsForOwner(db, "alice@x.com").map((t) => t.sdkSessionId);
    expect(ids).toEqual(["a2", "a1"]);
  });

  it("returns an empty list for an owner with no threads", () => {
    expect(listThreadsForOwner(db, "nobody@x.com")).toEqual([]);
  });

  it("skips a pre-minted row that has no title yet", () => {
    recordThread(db, "premint", "alice@x.com", undefined, "2026-09-07T09:00:00Z");
    const ids = listThreadsForOwner(db, "alice@x.com").map((t) => t.sdkSessionId);
    expect(ids).not.toContain("premint");
    expect(ids.sort()).toEqual(["a1", "a2"]);
  });

  it("shows the row once its first turn titles it", () => {
    recordThread(db, "premint", "alice@x.com", undefined, "2026-09-07T09:00:00Z");
    recordThread(db, "premint", "alice@x.com", "what is the points doctrine", "2026-09-07T09:00:05Z");
    expect(listThreadsForOwner(db, "alice@x.com").map((t) => t.sdkSessionId)).toContain("premint");
  });
});

describe("setThreadPinned", () => {
  beforeEach(() => {
    recordThread(db, "p1", "alice@x.com", "alice thread", "2026-06-25T09:00:00Z");
  });

  it("pins and unpins the owner's own thread", () => {
    expect(setThreadPinned(db, "p1", "alice@x.com", true)).toBe(true);
    expect(listThreadsForOwner(db, "alice@x.com")[0].pinned).toBe(true);
    expect(setThreadPinned(db, "p1", "alice@x.com", false)).toBe(true);
    expect(listThreadsForOwner(db, "alice@x.com")[0].pinned).toBe(false);
  });

  it("refuses to pin another owner's thread (no row updated)", () => {
    expect(setThreadPinned(db, "p1", "mallory@x.com", true)).toBe(false);
    expect(listThreadsForOwner(db, "alice@x.com")[0].pinned).toBe(false);
  });

  it("returns false for an unknown thread id", () => {
    expect(setThreadPinned(db, "nope", "alice@x.com", true)).toBe(false);
  });

  it("defaults a freshly recorded thread to unpinned", () => {
    expect(listThreadsForOwner(db, "alice@x.com")[0].pinned).toBe(false);
  });
});

describe("setThreadTitle", () => {
  beforeEach(() => {
    recordThread(db, "t1", "alice@x.com", "auto title", "2026-06-25T09:00:00Z");
  });

  it("renames the owner's own thread", () => {
    expect(setThreadTitle(db, "t1", "alice@x.com", "Deliberate title")).toBe(true);
    expect(listThreadsForOwner(db, "alice@x.com")[0].title).toBe("Deliberate title");
  });

  it("refuses to rename another owner's thread (no row updated)", () => {
    expect(setThreadTitle(db, "t1", "mallory@x.com", "hijacked")).toBe(false);
    expect(listThreadsForOwner(db, "alice@x.com")[0].title).toBe("auto title");
  });

  it("returns false for an unknown thread id", () => {
    expect(setThreadTitle(db, "nope", "alice@x.com", "x")).toBe(false);
  });
});

describe("deleteThread", () => {
  beforeEach(() => {
    recordThread(db, "d1", "alice@x.com", "alice thread", "2026-06-25T09:00:00Z");
    recordThread(db, "d2", "alice@x.com", "another", "2026-06-25T10:00:00Z");
  });

  it("deletes the owner's own thread, leaving their other threads", () => {
    expect(deleteThread(db, "d1", "alice@x.com")).toBe(true);
    const remaining = listThreadsForOwner(db, "alice@x.com").map((t) => t.sdkSessionId);
    expect(remaining).toEqual(["d2"]);
    // Ownership is gone, so a resume check can no longer find it.
    expect(getThreadOwner(db, "d1")).toBeNull();
  });

  it("refuses to delete another owner's thread (no row removed)", () => {
    expect(deleteThread(db, "d1", "mallory@x.com")).toBe(false);
    expect(getThreadOwner(db, "d1")).toBe("alice@x.com");
  });

  it("returns false for an unknown thread id", () => {
    expect(deleteThread(db, "nope", "alice@x.com")).toBe(false);
  });
});

describe("thread model/effort override", () => {
  beforeEach(() => {
    recordThread(db, "m1", "alice@x.com", "alice thread", "2026-06-25T09:00:00Z");
  });

  it("defaults to null/null before any override is set", () => {
    expect(getThreadModelChoice(db, "m1")).toEqual({ model: null, effort: null });
  });

  it("stores and reads back the owner's own override", () => {
    expect(setThreadModelChoice(db, "m1", "alice@x.com", { model: "claude-sonnet-4-6", effort: "low" })).toBe(true);
    expect(getThreadModelChoice(db, "m1")).toEqual({ model: "claude-sonnet-4-6", effort: "low" });
  });

  it("only updates the field(s) present: a partial update never clobbers the other", () => {
    setThreadModelChoice(db, "m1", "alice@x.com", { model: "claude-sonnet-4-6", effort: "low" });
    // Change effort alone: the model must survive.
    expect(setThreadModelChoice(db, "m1", "alice@x.com", { effort: "max" })).toBe(true);
    expect(getThreadModelChoice(db, "m1")).toEqual({ model: "claude-sonnet-4-6", effort: "max" });
    // Change model alone: the effort must survive.
    expect(setThreadModelChoice(db, "m1", "alice@x.com", { model: "claude-opus-4-8" })).toBe(true);
    expect(getThreadModelChoice(db, "m1")).toEqual({ model: "claude-opus-4-8", effort: "max" });
  });

  it("refuses to change another owner's thread", () => {
    expect(setThreadModelChoice(db, "m1", "mallory@x.com", { model: "x", effort: "max" })).toBe(false);
    expect(getThreadModelChoice(db, "m1")).toEqual({ model: null, effort: null });
  });

  it("is a no-op (false) with an empty patch", () => {
    expect(setThreadModelChoice(db, "m1", "alice@x.com", {})).toBe(false);
  });

  it("returns null for an unknown thread", () => {
    expect(getThreadModelChoice(db, "nope")).toBeNull();
  });
});

describe("getThreadOwner", () => {
  it("returns null for an unknown session id", () => {
    expect(getThreadOwner(db, "does-not-exist")).toBeNull();
  });

  it("returns the recorded owner for a known session id", () => {
    recordThread(db, "s1", "alice@x.com", "t");
    expect(getThreadOwner(db, "s1")).toBe("alice@x.com");
  });
});

it("marks a thread dirty and lists it, then clears on dream", () => {
  recordThread(db, "s1", "a@b.com", "hi", "2026-07-07T00:00:00.000Z");
  expect(listDirtyForOwner(db, "a@b.com")).toHaveLength(0);

  expect(isThreadDirty(db, "s1")).toBe(false);

  markDirty(db, "s1", "2026-07-07T00:01:00.000Z");
  const dirty = listDirtyForOwner(db, "a@b.com");
  expect(dirty.map((t) => t.sdkSessionId)).toEqual(["s1"]);
  expect(dirty[0].dirty).toBe(true);
  expect(isThreadDirty(db, "s1")).toBe(true);

  markDreamed(db, "s1", "2026-07-07T00:02:00.000Z");
  expect(listDirtyForOwner(db, "a@b.com")).toHaveLength(0);
  expect(isThreadDirty(db, "s1")).toBe(false);
  expect(isThreadDirty(db, "unknown-id")).toBe(false);
  const owner = listThreadsForOwner(db, "a@b.com")[0];
  expect(owner.dirty).toBe(false);
  expect(owner.dreamedAt).toBe("2026-07-07T00:02:00.000Z");
});
