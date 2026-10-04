import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { openDb } from "./client";

const TABLES = [
  "llm_keys",
  "llm_model_groups",
  "llm_budgets",
  "llm_usage",
  "llm_usage_daily",
  "llm_usage_batches",
  "llm_budget_requests",
];

function seedAt(upTo: number): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "portal-db-mig-v43-")), "portal.db");
  const db = new Database(file);
  for (let version = 0; version < upTo; version++) MIGRATIONS[version](db);
  db.pragma(`user_version = ${upTo}`);
  db.close();
  return file;
}

describe("migration v42 -> v43", () => {
  it("adds the LLM key and budget tables to a database stopped at v42", () => {
    const db = openDb(seedAt(42));
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(43);
    for (const name of TABLES) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
      expect(row, name).toBeDefined();
    }
  });

  it("refuses an unknown period and a duplicate key hash", () => {
    const db = openDb(":memory:");
    const group = db.prepare(
      `INSERT INTO llm_model_groups (slug, label, models, default_tokens, period, created_at, updated_at)
       VALUES (@slug, 'L', '[]', NULL, @period, 't', 't')`,
    );
    expect(() => group.run({ slug: "a", period: "year" })).toThrow(/CHECK/i);
    const key = db.prepare(
      `INSERT INTO llm_keys (id, owner_email, router_key_id, key_hash, key_hint, label, status, created_at)
       VALUES (@id, 'a@x.io', 'r', 'h', 'abcd', 'l', 'active', 't')`,
    );
    key.run({ id: "k1" });
    expect(() => key.run({ id: "k2" })).toThrow(/UNIQUE/i);
  });
});
