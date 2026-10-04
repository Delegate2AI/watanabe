import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { migrate } from "./migrate";
import { createState, consumeState, pruneStates } from "./connector-oauth-states";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("createState", () => {
  it("creates an oauth state and returns it", () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + 300000).toISOString();

    const state = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier123",
      fingerprint: "fp123",
      createdAt: now,
      expiresAt,
      configSnapshot: "snapshot-1",
    });

    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
  });

  it("invalidates previous state for same caller and slug", () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + 300000).toISOString();

    const state1 = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier1",
      fingerprint: "fp1",
      createdAt: now,
      expiresAt,
      configSnapshot: "snapshot-1",
    });

    const state2 = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier2",
      fingerprint: "fp2",
      createdAt: now,
      expiresAt,
      configSnapshot: "snapshot-2",
    });

    const row1 = consumeState(db, state1);
    expect(row1).toBeNull();

    const row2 = consumeState(db, state2);
    expect(row2).toBeDefined();
    expect(row2?.verifier).toBe("verifier2");
  });
});

describe("consumeState", () => {
  it("returns null when state does not exist", () => {
    const row = consumeState(db, "nonexistent-state");
    expect(row).toBeNull();
  });

  it("returns the state row and deletes it", () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) + 300000).toISOString();

    const state = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier123",
      fingerprint: "fp123",
      createdAt: now,
      expiresAt,
      configSnapshot: "snapshot-1",
    });

    const row = consumeState(db, state);
    expect(row).toMatchObject({
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier123",
      fingerprint: "fp123",
      configSnapshot: "snapshot-1",
    });

    const secondAttempt = consumeState(db, state);
    expect(secondAttempt).toBeNull();
  });

  it("returns null for expired states", () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(now) - 1000).toISOString();

    const state = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "verifier123",
      fingerprint: "fp123",
      createdAt: now,
      expiresAt,
      configSnapshot: "snapshot-1",
    });

    const row = consumeState(db, state);
    expect(row).toBeNull();
  });
});

describe("pruneStates", () => {
  it("deletes expired states", () => {
    const baseTime = new Date().toISOString();
    const expiredAt = new Date(Date.parse(baseTime) - 1000).toISOString();
    const validAt = new Date(Date.parse(baseTime) + 300000).toISOString();

    const state1 = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "github",
      verifier: "v1",
      fingerprint: "fp1",
      createdAt: baseTime,
      expiresAt: expiredAt,
      configSnapshot: "snapshot-1",
    });

    const state2 = createState(db, {
      callerEmail: "user@example.com",
      connectorSlug: "gitlab",
      verifier: "v2",
      fingerprint: "fp2",
      createdAt: baseTime,
      expiresAt: validAt,
      configSnapshot: "snapshot-2",
    });

    pruneStates(db, baseTime);

    const row1 = consumeState(db, state1);
    expect(row1).toBeNull();

    const row2 = consumeState(db, state2);
    expect(row2).toBeDefined();
  });

  it("handles empty table", () => {
    expect(() => pruneStates(db, new Date().toISOString())).not.toThrow();
  });
});
