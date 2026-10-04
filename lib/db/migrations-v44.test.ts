import { describe, expect, it } from "vitest";
import { openDb } from "./client";

describe("migration v43 -> v44", () => {
  it("indexes the LLM usage reads by period, day and batch age", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBeGreaterThanOrEqual(44);
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'llm_usage%'`).all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["llm_usage_period", "llm_usage_daily_day", "llm_usage_batches_received"]));
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM llm_usage WHERE period_start IN ('2026-10-01', '2026-10-04')`).all() as Array<{ detail: string }>;
    expect(plan.map((p) => p.detail).join(" ")).toContain("llm_usage_period");
  });
});
