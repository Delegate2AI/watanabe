import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordUsage } from "./usage";
import type { UsageEvent } from "@/lib/usage/types";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

const BASE: UsageEvent = {
  resultId: "result-1",
  at: "2026-09-07T10:00:00.000Z",
  source: "chat",
  ownerEmail: "alice@example.com",
  threadId: "thread-1",
  model: "claude-opus-4-8",
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 5,
  cacheCreationTokens: 7,
  costUsd: 0.25,
  durationMs: 1800,
  ok: true,
};

function stored(): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM usage_events ORDER BY model`).all() as Record<string, unknown>[];
}

describe("recordUsage", () => {
  it("writes one row per model, sharing the result id", () => {
    const written = recordUsage(db, [BASE, { ...BASE, model: "claude-haiku-4-5", costUsd: 0.01 }]);

    expect(written).toBe(2);
    const rows = stored();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.result_id)).toEqual(["result-1", "result-1"]);
    expect(rows[1]).toMatchObject({
      owner_email: "alice@example.com",
      thread_id: "thread-1",
      source: "chat",
      input_tokens: 100,
      cache_creation_tokens: 7,
      cost_usd: 0.25,
      duration_ms: 1800,
      ok: 1,
    });
  });

  it("ignores a replay of the same result and model", () => {
    recordUsage(db, [BASE]);

    expect(recordUsage(db, [BASE])).toBe(0);
    expect(stored()).toHaveLength(1);
  });

  it("stores a system row with a null owner and a failed turn as ok zero", () => {
    recordUsage(db, [{ ...BASE, source: "meetings", ownerEmail: null, threadId: null, ok: false }]);

    expect(stored()[0]).toMatchObject({ owner_email: null, thread_id: null, ok: 0, source: "meetings" });
  });

  it("writes nothing for an empty batch", () => {
    expect(recordUsage(db, [])).toBe(0);
    expect(stored()).toHaveLength(0);
  });
});
