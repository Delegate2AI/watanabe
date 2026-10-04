import { describe, it, expect, beforeEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { listTokens, mintToken, resolveToken, revokeToken, touchToken } from "./tokens";

/**
 * The credential an MCP client presents. Stored only as a hash, so the
 * plaintext exists exactly once: in the response to the mint that created it.
 */

let db: DatabaseType;
const ALICE = "alice@example.com";
const BOB = "bob@example.com";
const T1 = "2026-08-21T10:00:00.000Z";
const T2 = "2026-08-21T11:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
});

describe("mintToken", () => {
  it("returns a plaintext token that resolves back to its owner", () => {
    const { id, token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    expect(token.length).toBeGreaterThan(20);
    expect(resolveToken(db, token)).toEqual({ id, ownerEmail: ALICE });
  });

  it("never stores the plaintext anywhere in the row", () => {
    const { token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    const rows = db.prepare("SELECT * FROM mcp_tokens").all() as Record<string, unknown>[];
    const values = rows.flatMap((row) => Object.values(row)).map(String);
    expect(values).not.toContain(token);
  });

  it("gives two mints two different tokens", () => {
    const a = mintToken(db, { ownerEmail: ALICE, name: "one" }, T1);
    const b = mintToken(db, { ownerEmail: ALICE, name: "two" }, T1);
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});

describe("resolveToken", () => {
  it("answers null for an unknown token and for a revoked one identically", () => {
    const { id, token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    revokeToken(db, id, ALICE, T2);
    expect(resolveToken(db, token)).toBeNull();
    expect(resolveToken(db, "never-minted")).toBeNull();
  });

  it("answers null for an empty credential rather than matching a row", () => {
    mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    expect(resolveToken(db, "")).toBeNull();
    expect(resolveToken(db, "   ")).toBeNull();
  });
});

/**
 * A refused credential must do the same work as an accepted one up to the point
 * of refusal, or the difference is measurable. The stamp is the only write, so
 * it happens after the caller has decided to accept, not during the lookup.
 */
describe("resolveToken does not write", () => {
  it("leaves last used untouched, so a hit and a miss do the same work", () => {
    const { token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    resolveToken(db, token);
    resolveToken(db, "invented");
    expect(listTokens(db, ALICE)[0].lastUsedAt).toBeNull();
  });

  it("stamps only when the caller marks the credential used", () => {
    const { id, token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    const resolved = resolveToken(db, token);
    expect(resolved).toEqual({ id, ownerEmail: ALICE });
    touchToken(db, id, T2);
    expect(listTokens(db, ALICE)[0].lastUsedAt).toBe(T2);
  });
});

describe("expiry", () => {
  // A portal token has no expiry and must never acquire one by accident: the
  // NULL has to read as "never", not as "already gone".
  it("keeps resolving a token with no expiry, however late the clock is", () => {
    const { id, token } = mintToken(db, { ownerEmail: ALICE, name: "laptop" });

    expect(resolveToken(db, token, "2099-01-01T00:00:00Z")).toEqual({ id, ownerEmail: ALICE });
  });

  it("stops resolving an expiring token once its moment has passed", () => {
    const { id, token } = mintToken(db, {
      ownerEmail: ALICE,
      name: "Claude",
      clientId: "c1",
      expiresAt: "2026-09-05T13:00:00Z",
    });

    expect(resolveToken(db, token, "2026-09-05T12:59:59Z")).toEqual({ id, ownerEmail: ALICE });
    expect(resolveToken(db, token, "2026-09-05T13:00:01Z")).toBeNull();
  });

  // An expired credential and an invented one take the same path and answer the
  // same way, so neither is separable from the other.
  it("refuses an expired token exactly as it refuses an unknown one", () => {
    const { token } = mintToken(db, {
      ownerEmail: ALICE,
      name: "Claude",
      clientId: "c1",
      expiresAt: "2026-09-05T13:00:00Z",
    });

    expect(resolveToken(db, token, "2026-09-06T00:00:00Z")).toBeNull();
    expect(resolveToken(db, "never-existed", "2026-09-06T00:00:00Z")).toBeNull();
  });
});

describe("listTokens", () => {
  it("carries no hash and no plaintext", () => {
    mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    const summary = listTokens(db, ALICE)[0];
    expect(Object.keys(summary).sort()).toEqual([
      "clientId",
      "createdAt",
      "id",
      "lastUsedAt",
      "name",
      "revokedAt",
    ]);
  });

  it("is scoped to the owner", () => {
    mintToken(db, { ownerEmail: ALICE, name: "hers" }, T1);
    mintToken(db, { ownerEmail: BOB, name: "his" }, T1);
    expect(listTokens(db, ALICE).map((t) => t.name)).toEqual(["hers"]);
  });

  it("still lists a revoked token, so a revocation is visible rather than silent", () => {
    const { id } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    revokeToken(db, id, ALICE, T2);
    expect(listTokens(db, ALICE)[0].revokedAt).toBe(T2);
  });
});

describe("revokeToken", () => {
  it("is owner-scoped: one admin cannot revoke another's", () => {
    const { id, token } = mintToken(db, { ownerEmail: ALICE, name: "hers" }, T1);
    expect(revokeToken(db, id, BOB, T2)).toBe(false);
    expect(resolveToken(db, token)).not.toBeNull();
  });

  it("is idempotent, so a second revoke is not an error", () => {
    const { id } = mintToken(db, { ownerEmail: ALICE, name: "laptop" }, T1);
    expect(revokeToken(db, id, ALICE, T2)).toBe(true);
    expect(revokeToken(db, id, ALICE, T2)).toBe(true);
  });

  it("reports false for an id that does not exist", () => {
    expect(revokeToken(db, "no-such-id", ALICE, T2)).toBe(false);
  });
});
