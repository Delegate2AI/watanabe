import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { MIGRATIONS } from "./migrations";
import { recordThread } from "./threads";
import {
  insertPackage,
  getPackage,
  listPackagesForOwner,
  markProcessing,
  markSubmitted,
  markNoChanges,
  markFailed,
  requeueForRetry,
  requeueStuckProcessing,
  listQueuedIds,
  deletePackage,
} from "./packages";

// The packages table tracks one doc-package upload through its ingestion
// lifecycle: queued -> processing -> (submitted | no_changes | failed), with
// failed/no_changes retryable back to queued. Every test runs against a
// fresh in-memory DB, mirroring lib/db/threads.test.ts.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("insertPackage / getPackage", () => {
  it("creates a package with status queued and returns it via getPackage", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "Q3 docs" }, "2026-07-01T00:00:00Z");
    const pkg = getPackage(db, "p1");
    expect(pkg).toEqual({
      id: "p1",
      ownerEmail: "alice@x.com",
      ownerName: null,
      name: "Q3 docs",
      status: "queued",
      threadId: null,
      mrUrl: null,
      report: null,
      error: null,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    });
  });

  it("stores ownerName when provided", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", ownerName: "Alice", name: "Q3 docs" });
    expect(getPackage(db, "p1")?.ownerName).toBe("Alice");
  });

  it("returns null for an unknown id", () => {
    expect(getPackage(db, "does-not-exist")).toBeNull();
  });
});

describe("lifecycle transitions", () => {
  it("queued -> processing -> submitted", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");

    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");
    let pkg = getPackage(db, "p1");
    expect(pkg?.status).toBe("processing");
    expect(pkg?.threadId).toBe("thread-1");
    expect(pkg?.updatedAt).toBe("2026-07-01T00:01:00Z");

    markSubmitted(db, "p1", { mrUrl: "https://gitlab/mr/1", report: "did stuff" }, "2026-07-01T00:02:00Z");
    pkg = getPackage(db, "p1");
    expect(pkg?.status).toBe("submitted");
    expect(pkg?.mrUrl).toBe("https://gitlab/mr/1");
    expect(pkg?.report).toBe("did stuff");
    expect(pkg?.updatedAt).toBe("2026-07-01T00:02:00Z");
  });

  it("queued -> processing -> no_changes", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");

    markNoChanges(db, "p1", "nothing to update", "2026-07-01T00:02:00Z");
    const pkg = getPackage(db, "p1");
    expect(pkg?.status).toBe("no_changes");
    expect(pkg?.report).toBe("nothing to update");
    expect(pkg?.updatedAt).toBe("2026-07-01T00:02:00Z");
  });

  it("queued -> processing -> failed, with optional report", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");

    markFailed(db, "p1", { error: "boom", report: "partial report" }, "2026-07-01T00:02:00Z");
    const pkg = getPackage(db, "p1");
    expect(pkg?.status).toBe("failed");
    expect(pkg?.error).toBe("boom");
    expect(pkg?.report).toBe("partial report");
    expect(pkg?.updatedAt).toBe("2026-07-01T00:02:00Z");
  });

  it("markFailed without a report leaves report null", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markFailed(db, "p1", { error: "boom" }, "2026-07-01T00:01:00Z");
    expect(getPackage(db, "p1")?.report).toBeNull();
  });
});

describe("owner scoping + ordering", () => {
  beforeEach(() => {
    insertPackage(db, { id: "a1", ownerEmail: "alice@x.com", name: "alice pkg 1" }, "2026-07-01T09:00:00Z");
    insertPackage(db, { id: "a2", ownerEmail: "alice@x.com", name: "alice pkg 2" }, "2026-07-01T12:00:00Z");
    insertPackage(db, { id: "b1", ownerEmail: "bob@x.com", name: "bob pkg 1" }, "2026-07-01T10:00:00Z");
  });

  it("only returns packages for the given owner", () => {
    const aliceIds = listPackagesForOwner(db, "alice@x.com").map((p) => p.id);
    expect(aliceIds.sort()).toEqual(["a1", "a2"]);

    const bobIds = listPackagesForOwner(db, "bob@x.com").map((p) => p.id);
    expect(bobIds).toEqual(["b1"]);
  });

  it("orders by updatedAt, newest first", () => {
    const ids = listPackagesForOwner(db, "alice@x.com").map((p) => p.id);
    expect(ids).toEqual(["a2", "a1"]);
  });

  it("returns an empty list for an owner with no packages", () => {
    expect(listPackagesForOwner(db, "nobody@x.com")).toEqual([]);
  });
});

describe("requeueForRetry", () => {
  it("requeues a failed package: clears mr_url/error/report, sets status queued", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");
    markFailed(db, "p1", { error: "boom", report: "partial" }, "2026-07-01T00:02:00Z");

    const ok = requeueForRetry(db, "p1", "2026-07-01T00:03:00Z");
    expect(ok).toBe(true);

    const pkg = getPackage(db, "p1");
    expect(pkg?.status).toBe("queued");
    expect(pkg?.mrUrl).toBeNull();
    expect(pkg?.error).toBeNull();
    expect(pkg?.report).toBeNull();
    expect(pkg?.updatedAt).toBe("2026-07-01T00:03:00Z");
  });

  it("requeues a no_changes package", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");
    markNoChanges(db, "p1", "nothing", "2026-07-01T00:02:00Z");

    const ok = requeueForRetry(db, "p1", "2026-07-01T00:03:00Z");
    expect(ok).toBe(true);
    expect(getPackage(db, "p1")?.status).toBe("queued");
  });

  it("refuses to requeue a processing package", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");

    const ok = requeueForRetry(db, "p1", "2026-07-01T00:02:00Z");
    expect(ok).toBe(false);
    expect(getPackage(db, "p1")?.status).toBe("processing");
  });

  it("refuses to requeue an already-queued package", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    const ok = requeueForRetry(db, "p1", "2026-07-01T00:01:00Z");
    expect(ok).toBe(false);
    expect(getPackage(db, "p1")?.status).toBe("queued");
  });

  it("refuses to requeue a submitted package", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "thread-1", "2026-07-01T00:01:00Z");
    markSubmitted(db, "p1", { mrUrl: "https://gitlab/mr/1", report: "r" }, "2026-07-01T00:02:00Z");

    const ok = requeueForRetry(db, "p1", "2026-07-01T00:03:00Z");
    expect(ok).toBe(false);
    expect(getPackage(db, "p1")?.status).toBe("submitted");
  });

  it("returns false for an unknown id", () => {
    expect(requeueForRetry(db, "does-not-exist", "2026-07-01T00:00:00Z")).toBe(false);
  });
});

describe("requeueStuckProcessing", () => {
  it("moves only processing packages back to queued and returns their ids", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p2", ownerEmail: "alice@x.com", name: "n2" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p3", ownerEmail: "alice@x.com", name: "n3" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "t1", "2026-07-01T00:01:00Z");
    markProcessing(db, "p2", "t2", "2026-07-01T00:01:00Z");
    // p3 stays queued

    const ids = requeueStuckProcessing(db, "2026-07-01T00:05:00Z");
    expect(ids.sort()).toEqual(["p1", "p2"]);

    expect(getPackage(db, "p1")?.status).toBe("queued");
    expect(getPackage(db, "p1")?.updatedAt).toBe("2026-07-01T00:05:00Z");
    expect(getPackage(db, "p2")?.status).toBe("queued");
    expect(getPackage(db, "p3")?.status).toBe("queued");
    expect(getPackage(db, "p3")?.updatedAt).toBe("2026-07-01T00:00:00Z");
  });

  it("returns an empty array when nothing is stuck processing", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    expect(requeueStuckProcessing(db, "2026-07-01T00:05:00Z")).toEqual([]);
  });
});

describe("listQueuedIds", () => {
  it("returns ids of packages currently in queued status", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p2", ownerEmail: "alice@x.com", name: "n2" }, "2026-07-01T00:00:00Z");
    insertPackage(db, { id: "p3", ownerEmail: "alice@x.com", name: "n3" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p2", "t1", "2026-07-01T00:01:00Z");

    expect(listQueuedIds(db).sort()).toEqual(["p1", "p3"]);
  });

  it("returns an empty array when nothing is queued", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n1" }, "2026-07-01T00:00:00Z");
    markProcessing(db, "p1", "t1", "2026-07-01T00:01:00Z");
    expect(listQueuedIds(db)).toEqual([]);
  });
});

describe("deletePackage", () => {
  it("removes the package so getPackage returns null", () => {
    insertPackage(db, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    deletePackage(db, "p1");
    expect(getPackage(db, "p1")).toBeNull();
  });

  it("is a no-op for an unknown id", () => {
    expect(() => deletePackage(db, "does-not-exist")).not.toThrow();
  });
});

describe("migration v3", () => {
  const tmpFiles: string[] = [];

  function tmpDbPath(): string {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-packages-")), "portal.db");
    tmpFiles.push(path.dirname(p));
    return p;
  }

  afterEach(() => {
    while (tmpFiles.length) {
      const dir = tmpFiles.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a fresh DB ends at the latest user_version with the packages table + index present", () => {
    const fresh = openDb(":memory:");
    expect(fresh.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    const table = fresh
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'packages'`)
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("packages");

    const index = fresh
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_packages_owner_updated'`)
      .get() as { name: string } | undefined;
    expect(index?.name).toBe("idx_packages_owner_updated");
    fresh.close();
  });

  it("migration is idempotent after reopen with thread data intact", () => {
    const file = tmpDbPath();

    const first = openDb(file);
    recordThread(first, "s1", "alice@x.com", "hello", "2026-07-01T00:00:00Z");
    insertPackage(first, { id: "p1", ownerEmail: "alice@x.com", name: "n" }, "2026-07-01T00:00:00Z");
    expect(first.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    first.close();

    const second = openDb(file);
    expect(second.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    const threadRows = second.prepare(`SELECT sdk_session_id FROM threads`).all() as Array<{
      sdk_session_id: string;
    }>;
    expect(threadRows.map((r) => r.sdk_session_id)).toEqual(["s1"]);
    const pkgRows = second.prepare(`SELECT id FROM packages`).all() as Array<{ id: string }>;
    expect(pkgRows.map((r) => r.id)).toEqual(["p1"]);
    second.close();
  });
});
