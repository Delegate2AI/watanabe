import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { setBudget } from "@/lib/db/llm-budgets";
import { upsertModelGroup } from "@/lib/db/llm-groups";
import { createBudgetRequest } from "@/lib/db/llm-requests";
import { addBonusTokens, applyUsageBatch } from "@/lib/db/llm-usage";
import { loadAdminData } from "./admin-view";

describe("loadAdminData", () => {
  it("joins requests to the requester's current figures and splits usage by month", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-10-04T12:00:00.000Z");
    upsertModelGroup(db, { slug: "paid", label: "Paid", models: ["anthropic/*"], defaultTokens: 1000, period: "month" });
    setBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5000, period: "week", allowed: true, updatedBy: "x" });
    addBonusTokens(db, "ana@corp.io", "paid", "2026-09-28", 500);
    const delta = (day: string, periodStart: string) => ({
      ownerEmail: "ana@corp.io", groupSlug: "paid", model: "anthropic/m", periodStart, day,
      inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, requests: 1,
    });
    applyUsageBatch(db, "b1", [delta("2026-10-02", "2026-09-28"), delta("2026-09-15", "2026-09-15")], now.toISOString());
    createBudgetRequest(db, { requesterEmail: "ana@corp.io", groupSlug: "paid", requestedTokens: 9, reason: "r" });

    const data = loadAdminData(db, { eng: ["ana@corp.io"], admins: ["boss@corp.io"] }, now);

    expect(data.requests[0]).toMatchObject({ groupLabel: "Paid", used: 110, limit: 5500, period: "week" });
    expect(data.usageThisMonth).toEqual([expect.objectContaining({ model: "anthropic/m", inputTokens: 100 })]);
    expect(data.usageLastMonth).toEqual([expect.objectContaining({ inputTokens: 100 })]);
    expect(data.teams).toEqual(["all-hands", "admins", "eng"]);
    expect(data.seenModels).toEqual(["anthropic/m"]);
  });
});
