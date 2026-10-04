import { describe, expect, it } from "vitest";
import { resolveBudget } from "./resolve";
import type { BudgetRow, ModelGroup } from "./types";

const group: ModelGroup = { slug: "paid", label: "Paid", models: ["anthropic/*"], defaultTokens: 50_000, period: "day" };

function row(over: Partial<BudgetRow>): BudgetRow {
  return { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 1000, period: "day", allowed: true, ...over };
}

describe("resolveBudget", () => {
  it("falls back to the group default", () => {
    expect(resolveBudget({ email: "a@x.io", teams: ["eng"], group, budgets: [] })).toEqual({
      groupSlug: "paid", allowed: true, tokens: 50_000, period: "day", source: "default",
    });
  });

  it("prefers a user row over every team row, matching the email case-insensitively", () => {
    const budgets = [row({ tokens: null }), row({ subjectKind: "user", subject: "a@x.io", tokens: 10 })];
    const got = resolveBudget({ email: "A@X.io", teams: ["eng"], group, budgets });
    expect(got).toMatchObject({ tokens: 10, source: "user" });
  });

  it("ignores rows for other groups and teams the user is not in", () => {
    const budgets = [row({ groupSlug: "local", tokens: 1 }), row({ subject: "sales", tokens: 2 })];
    expect(resolveBudget({ email: "a@x.io", teams: ["eng"], group, budgets }).source).toBe("default");
  });

  it("takes the most generous team: allowed beats blocked, unlimited beats a number", () => {
    const budgets = [
      row({ subject: "eng", allowed: false }),
      row({ subject: "ops", tokens: 5 }),
      row({ subject: "data", tokens: null }),
    ];
    expect(resolveBudget({ email: "a@x.io", teams: ["eng", "ops", "data"], group, budgets })).toMatchObject({
      allowed: true, tokens: null, source: "team",
    });
  });

  it("compares numbers across periods by rate per day", () => {
    const budgets = [
      row({ subject: "eng", tokens: 100_000, period: "day" }),
      row({ subject: "ops", tokens: 1_000_000, period: "month" }),
    ];
    expect(resolveBudget({ email: "a@x.io", teams: ["eng", "ops"], group, budgets })).toMatchObject({
      tokens: 100_000, period: "day",
    });
  });

  it("breaks an equal rate in favour of the longer period", () => {
    const budgets = [row({ subject: "eng", tokens: 7, period: "day" }), row({ subject: "ops", tokens: 49, period: "week" })];
    expect(resolveBudget({ email: "a@x.io", teams: ["eng", "ops"], group, budgets }).period).toBe("week");
  });

  it("blocks when the only matching team row is blocked", () => {
    const budgets = [row({ subject: "all-hands", allowed: false })];
    expect(resolveBudget({ email: "a@x.io", teams: ["all-hands"], group, budgets }).allowed).toBe(false);
  });
});
