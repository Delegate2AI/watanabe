import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { activeRefreshCount, issueRefreshToken, rotateRefreshToken } from "./refresh";

let db: import("better-sqlite3").Database;

const GRANT = { clientId: "c1", ownerEmail: "alice@example.com" };

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("issueRefreshToken", () => {
  it("stores only a hash, never the token", () => {
    const { token } = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");
    const row = db.prepare(`SELECT token_hash FROM oauth_refresh_tokens`).get() as { token_hash: string };

    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.token_hash).not.toBe(token);
  });
});

describe("rotateRefreshToken", () => {
  it("returns the owner and hands back a different token", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");

    const rotated = rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:00Z");

    expect(rotated).toMatchObject({ ownerEmail: "alice@example.com", clientId: "c1" });
    expect(rotated?.token).not.toBe(first.token);
  });

  it("refuses the superseded token once it has been rotated", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");
    rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:00Z");

    expect(rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:01Z")).toBeNull();
  });

  /**
   * Presenting a superseded refresh token is the signature of a stolen one:
   * either the thief or the legitimate client is using a token the other has
   * already spent. Neither can be told apart, so the whole chain goes.
   */
  it("revokes every token in the chain when a superseded one is presented", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");
    const second = rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:00Z");
    expect(activeRefreshCount(db, GRANT)).toBe(1);

    // The thief replays the one they captured.
    expect(rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:30:00Z")).toBeNull();

    // The legitimate client's current token is dead too, which is the point:
    // the person notices and reconnects rather than sharing access with a thief.
    expect(rotateRefreshToken(db, second!.token, "c1", "2026-09-05T14:00:00Z")).toBeNull();
    expect(activeRefreshCount(db, GRANT)).toBe(0);
  });

  it("refuses a token presented by a different client", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");

    expect(rotateRefreshToken(db, first.token, "c2", "2026-09-05T13:00:00Z")).toBeNull();
  });

  it("refuses a token past its lifetime", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");

    expect(rotateRefreshToken(db, first.token, "c1", "2026-11-05T12:00:00Z")).toBeNull();
  });

  it("refuses an invented token exactly as it refuses a spent one", () => {
    const first = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");
    rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:00Z");

    expect(rotateRefreshToken(db, first.token, "c1", "2026-09-05T13:00:01Z")).toBeNull();
    expect(rotateRefreshToken(db, "never-existed", "c1", "2026-09-05T13:00:01Z")).toBeNull();
  });

  it("keeps two people's chains apart, so one theft does not sign the other out", () => {
    const alice = issueRefreshToken(db, GRANT, "2026-09-05T12:00:00Z");
    const bob = issueRefreshToken(db, { clientId: "c1", ownerEmail: "bob@example.com" }, "2026-09-05T12:00:00Z");
    rotateRefreshToken(db, alice.token, "c1", "2026-09-05T13:00:00Z");

    expect(rotateRefreshToken(db, alice.token, "c1", "2026-09-05T13:30:00Z")).toBeNull();
    expect(rotateRefreshToken(db, bob.token, "c1", "2026-09-05T14:00:00Z")).not.toBeNull();
  });
});
