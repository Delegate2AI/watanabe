import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { addBonusTokens, applyUsageBatch, getUsage, listUsageForPeriods, summarizeDailyUsage } from "./llm-usage";
import type { UsageDelta } from "@/lib/llm/types";

let db: DatabaseType;
const T0 = "2026-10-03T12:00:00.000Z";
beforeEach(() => {
  db = openDb(":memory:");
});

function delta(over: Partial<UsageDelta> = {}): UsageDelta {
  return {
    ownerEmail: "ana@corp.io", groupSlug: "paid", model: "anthropic/claude-sonnet-4-5",
    periodStart: "2026-10-01", day: "2026-10-03",
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000, requests: 1, ...over,
  };
}

describe("llm usage", () => {
  it("adds deltas into the period row and the daily per-model row", () => {
    applyUsageBatch(db, "b1", [delta(), delta({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 0 })], T0);
    expect(getUsage(db, "ana@corp.io", "paid", "2026-10-01")).toEqual({
      inputTokens: 101, outputTokens: 22, cacheReadTokens: 5000, bonusTokens: 0, requests: 2,
    });
    const daily = db.prepare(`SELECT input_tokens, requests FROM llm_usage_daily`).all();
    expect(daily).toEqual([{ input_tokens: 101, requests: 2 }]);
  });

  it("ignores a batch it has already applied", () => {
    expect(applyUsageBatch(db, "b1", [delta()], T0)).toBe("applied");
    expect(applyUsageBatch(db, "b1", [delta()], T0)).toBe("duplicate");
    expect(getUsage(db, "ana@corp.io", "paid", "2026-10-01").inputTokens).toBe(100);
  });

  it("lowercases the owner and returns zeros for an unseen period", () => {
    applyUsageBatch(db, "b1", [delta({ ownerEmail: "Ana@Corp.io" })], T0);
    expect(getUsage(db, "ANA@corp.io", "paid", "2026-10-01").requests).toBe(1);
    expect(getUsage(db, "ana@corp.io", "paid", "2026-11-01")).toEqual({
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, bonusTokens: 0, requests: 0,
    });
  });

  it("records nothing for an empty batch, so idle gates do not grow the batch table", () => {
    expect(applyUsageBatch(db, "idle", [], T0)).toBe("applied");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM llm_usage_batches`).get()).toEqual({ n: 0 });
  });

  it("forgets batch ids older than a day, long past any gate retry", () => {
    applyUsageBatch(db, "old", [delta()], "2026-10-01T00:00:00.000Z");
    applyUsageBatch(db, "new", [delta()], T0);
    const ids = db.prepare(`SELECT batch_id FROM llm_usage_batches ORDER BY batch_id`).all();
    expect(ids).toEqual([{ batch_id: "new" }]);
  });

  it("lists usage rows for the given period starts only", () => {
    applyUsageBatch(db, "b1", [delta(), delta({ groupSlug: "local", periodStart: "2026-10-03" }), delta({ periodStart: "2026-09-01" })], T0);
    const rows = listUsageForPeriods(db, ["2026-10-01", "2026-10-03"]);
    expect(rows.map((r) => [r.ownerEmail, r.groupSlug, r.periodStart, r.inputTokens + r.outputTokens]).sort()).toEqual([
      ["ana@corp.io", "local", "2026-10-03", 120],
      ["ana@corp.io", "paid", "2026-10-01", 120],
    ]);
    expect(listUsageForPeriods(db, [])).toEqual([]);
  });

  it("adds bonus tokens to a period, creating the row if needed", () => {
    addBonusTokens(db, "Ana@Corp.io", "paid", "2026-10-01", 1000);
    addBonusTokens(db, "ana@corp.io", "paid", "2026-10-01", 500);
    applyUsageBatch(db, "b1", [delta()], T0);
    expect(getUsage(db, "ana@corp.io", "paid", "2026-10-01")).toMatchObject({ bonusTokens: 1500, inputTokens: 100 });
  });

  it("summarizes daily usage per owner and model across a day range", () => {
    applyUsageBatch(db, "b1", [delta(), delta({ day: "2026-10-04" }), delta({ day: "2026-09-30" }), delta({ model: "ollama/q" })], T0);
    expect(summarizeDailyUsage(db, "2026-10-01", "2026-10-04")).toEqual([
      { ownerEmail: "ana@corp.io", model: "anthropic/claude-sonnet-4-5", inputTokens: 200, outputTokens: 40, cacheReadTokens: 10000, requests: 2 },
      { ownerEmail: "ana@corp.io", model: "ollama/q", inputTokens: 100, outputTokens: 20, cacheReadTokens: 5000, requests: 1 },
    ]);
  });
});
