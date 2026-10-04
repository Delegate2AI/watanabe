import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { listThreadConnectors, setThreadConnector } from "./thread-connectors";

// `thread_connectors` access (spec 33): per-thread opt-in for external MCP
// connectors. Deliberately dumb at this layer: it stores and returns slugs
// verbatim, with no opinion on whether the slug is still in the registry.
// Filtering rows against the live registry is the grants layer's job, applied
// at read time there, not here.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("listThreadConnectors", () => {
  it("returns an empty array for a thread with no rows", () => {
    expect(listThreadConnectors(db, "thread-1")).toEqual([]);
  });

  it("returns enabled slugs, sorted", () => {
    setThreadConnector(db, "thread-1", "circleback", true);
    setThreadConnector(db, "thread-1", "another", true);
    expect(listThreadConnectors(db, "thread-1")).toEqual(["another", "circleback"]);
  });

  it("still returns a slug the registry no longer knows about (filtering is the grants layer's job)", () => {
    setThreadConnector(db, "thread-1", "retired-connector", true);
    expect(listThreadConnectors(db, "thread-1")).toEqual(["retired-connector"]);
  });

  it("scopes rows to their own thread", () => {
    setThreadConnector(db, "thread-1", "circleback", true);
    expect(listThreadConnectors(db, "thread-2")).toEqual([]);
  });
});

describe("setThreadConnector", () => {
  it("enabling returns true and the slug shows up in the list", () => {
    expect(setThreadConnector(db, "thread-1", "circleback", true)).toBe(true);
    expect(listThreadConnectors(db, "thread-1")).toEqual(["circleback"]);
  });

  it("enabling twice is idempotent: the second call returns false", () => {
    expect(setThreadConnector(db, "thread-1", "circleback", true)).toBe(true);
    expect(setThreadConnector(db, "thread-1", "circleback", true)).toBe(false);
    expect(listThreadConnectors(db, "thread-1")).toEqual(["circleback"]);
  });

  it("disabling removes the row", () => {
    setThreadConnector(db, "thread-1", "circleback", true);
    expect(setThreadConnector(db, "thread-1", "circleback", false)).toBe(true);
    expect(listThreadConnectors(db, "thread-1")).toEqual([]);
  });

  it("disabling a slug that was never enabled returns false", () => {
    expect(setThreadConnector(db, "thread-1", "circleback", false)).toBe(false);
  });
});
