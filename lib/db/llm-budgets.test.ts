import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { deleteBudget, listBudgets, setBudget } from "./llm-budgets";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("llm budgets", () => {
  it("upserts one row per subject and group, lowercasing user subjects", () => {
    setBudget(db, { subjectKind: "user", subject: "Ana@Corp.io", groupSlug: "paid", tokens: 10, period: "day", allowed: true, updatedBy: "admin@corp.io" }, "t1");
    setBudget(db, { subjectKind: "user", subject: "ana@corp.io", groupSlug: "paid", tokens: null, period: "month", allowed: false, updatedBy: "admin@corp.io" }, "t2");
    setBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5, period: "week", allowed: true, updatedBy: "admin@corp.io" }, "t3");
    expect(listBudgets(db)).toEqual([
      { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5, period: "week", allowed: true },
      { subjectKind: "user", subject: "ana@corp.io", groupSlug: "paid", tokens: null, period: "month", allowed: false },
    ]);
  });

  it("deletes by its key", () => {
    setBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5, period: "week", allowed: true, updatedBy: "a" }, "t");
    expect(deleteBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid" })).toBe(true);
    expect(listBudgets(db)).toEqual([]);
  });
});
