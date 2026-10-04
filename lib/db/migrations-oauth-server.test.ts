import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";
import { listTokens, mintToken, resolveToken } from "@/lib/mcp-auth/tokens";

/**
 * v38 -> v39 (watanabe as the authorization server): two nullable columns on
 * `mcp_tokens` and the three tables the OAuth flow needs.
 *
 * The risk worth testing is the UPGRADE path, and specifically that a portal
 * token minted before this migration keeps working afterwards: it acquires a
 * NULL `expires_at`, and the new expiry clause has to read that as "never"
 * rather than as "already expired". A `:memory:` database starts at version 0
 * and proves only the fresh path.
 */
function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v39-")), "portal.db");
}

/**
 * A database stopped at exactly `upTo`, then handed to `openDb` to run the rest.
 * The literal 38 is deliberate: `MIGRATIONS.length - 1` silently re-aims at a
 * different step every time a migration is appended.
 */
function seedAt(file: string, upTo: number): { token: string; id: string } {
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  // Written with raw SQL against the columns that existed at v38, deliberately
  // not through `mintToken`: the current minter writes client_id and
  // expires_at, which is exactly what the old schema does not have. This has to
  // be the row the OLD code would have left behind.
  const token = "pre-upgrade-token";
  const id = "tok-before";
  db.prepare(
    `INSERT INTO mcp_tokens (id, owner_email, name, token_hash, created_at)
     VALUES (@id, 'alice@example.com', 'laptop', @hash, '2026-09-01T12:00:00Z')`,
  ).run({ id, hash: createHash("sha256").update(token).digest("hex") });
  db.close();
  return { token, id };
}

describe("migration v38 -> v39", () => {
  it("keeps a token minted before the upgrade working, reading its null expiry as never", () => {
    const file = tmpDbPath();
    const before = seedAt(file, 38);

    const db = openDb(file);

    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(39);
    expect(resolveToken(db, before.token)).toEqual({ id: before.id, ownerEmail: "alice@example.com" });
    db.close();
  });

  it("reports a pre-existing token as a portal token, with no client behind it", () => {
    const file = tmpDbPath();
    seedAt(file, 38);
    const db = openDb(file);

    expect(listTokens(db, "alice@example.com")[0]).toMatchObject({ name: "laptop", clientId: null });
    db.close();
  });

  it("mints an expiring client token against the upgraded database", () => {
    const file = tmpDbPath();
    seedAt(file, 38);
    const db = openDb(file);

    const { id, token } = mintToken(
      db,
      { ownerEmail: "alice@example.com", name: "Claude", clientId: "c1", expiresAt: "2099-01-01T00:00:00Z" },
      "2026-09-05T12:00:00Z",
    );

    expect(resolveToken(db, token, "2026-09-05T12:30:00Z")).toEqual({ id, ownerEmail: "alice@example.com" });
    expect(listTokens(db, "alice@example.com")[0]).toMatchObject({ clientId: "c1" });
    db.close();
  });

  it("creates the three tables the authorization flow writes to", () => {
    const file = tmpDbPath();
    seedAt(file, 38);
    const db = openDb(file);

    for (const table of ["oauth_clients", "oauth_codes", "oauth_refresh_tokens"]) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table) as { name: string } | undefined;
      expect(row?.name).toBe(table);
    }
    db.close();
  });

  it("refuses two authorization codes with the same hash, which is what makes single use enforceable", () => {
    const file = tmpDbPath();
    seedAt(file, 38);
    const db = openDb(file);

    const insert = (client: string) =>
      db
        .prepare(
          `INSERT INTO oauth_codes (code_hash, client_id, owner_email, redirect_uri, code_challenge, created_at, expires_at)
           VALUES ('same-hash', @client, 'alice@example.com', 'https://x.test/cb', 'chal', '2026-09-05T12:00:00Z', '2026-09-05T12:01:00Z')`,
        )
        .run({ client });

    insert("c1");
    expect(() => insert("c2")).toThrow();
    db.close();
  });
});
