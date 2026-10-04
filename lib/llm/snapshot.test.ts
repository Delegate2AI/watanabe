import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { hashLlmKey, insertLlmKey, revokeLlmKey } from "@/lib/db/llm-keys";
import { upsertModelGroup } from "@/lib/db/llm-groups";
import { setBudget } from "@/lib/db/llm-budgets";
import { applyUsageBatch } from "@/lib/db/llm-usage";
import { buildSnapshot } from "./snapshot";

let db: DatabaseType;
const now = new Date("2026-10-03T12:00:00Z");

beforeEach(() => {
  db = openDb(":memory:");
  upsertModelGroup(db, { slug: "local", label: "Local", models: ["ollama/*"], defaultTokens: null, period: "day" }, "t");
  upsertModelGroup(db, { slug: "paid", label: "Paid", models: ["anthropic/*"], defaultTokens: 1000, period: "month" }, "t");
});

describe("buildSnapshot", () => {
  it("lists active keys, groups, and a resolved budget per owner and group", () => {
    insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-ana", label: "a" }, "t");
    const gone = insertLlmKey(db, { ownerEmail: "bo@corp.io", routerKeyId: "r2", key: "k-bo", label: "b" }, "t");
    revokeLlmKey(db, gone.id, "t");
    setBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5000, period: "week", allowed: true, updatedBy: "x" }, "t");
    applyUsageBatch(db, "b1", [{
      ownerEmail: "ana@corp.io", groupSlug: "paid", model: "anthropic/claude-sonnet-4-5", periodStart: "2026-09-28",
      day: "2026-10-03", inputTokens: 300, outputTokens: 50, cacheReadTokens: 9000, requests: 2,
    }], now.toISOString());

    const snap = buildSnapshot(db, { eng: ["ana@corp.io"] }, now);

    expect(snap.generatedAt).toBe(now.toISOString());
    expect(snap.keys).toEqual([{ id: expect.any(String), hash: hashLlmKey("k-ana"), ownerEmail: "ana@corp.io" }]);
    expect(snap.groups).toEqual([{ slug: "local", models: ["ollama/*"] }, { slug: "paid", models: ["anthropic/*"] }]);
    expect(snap.budgets).toEqual([
      { ownerEmail: "ana@corp.io", groupSlug: "local", allowed: true, tokens: null, period: "day",
        periodStart: "2026-10-03", resetAt: "2026-10-04T00:00:00.000Z", used: 0, bonus: 0 },
      { ownerEmail: "ana@corp.io", groupSlug: "paid", allowed: true, tokens: 5000, period: "week",
        periodStart: "2026-09-28", resetAt: "2026-10-05T00:00:00.000Z", used: 350, bonus: 0 },
    ]);
  });

  it("emits one budget set per owner however many keys they hold", () => {
    insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-1", label: "a" }, "t");
    insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r2", key: "k-2", label: "b" }, "t");
    expect(buildSnapshot(db, {}, now).budgets).toHaveLength(2);
  });
});
