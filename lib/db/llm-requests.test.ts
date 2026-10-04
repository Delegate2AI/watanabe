import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  createBudgetRequest, decideBudgetRequest, getBudgetRequest, listBudgetRequests, setBudgetRequestTask,
} from "./llm-requests";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

const base = { requesterEmail: " Ana@Corp.io ", groupSlug: "paid", requestedTokens: 500_000, reason: "release week" };

describe("llm budget requests", () => {
  it("creates a pending request with a lowercased requester", () => {
    const req = createBudgetRequest(db, base, "2026-10-04T10:00:00.000Z");
    expect(req).toMatchObject({
      requesterEmail: "ana@corp.io", groupSlug: "paid", requestedTokens: 500_000, reason: "release week",
      status: "pending", decision: null, grantedTokens: null, taskId: null, createdAt: "2026-10-04T10:00:00.000Z",
    });
    expect(getBudgetRequest(db, req.id)).toEqual(req);
  });

  it("lists pending first, then newest, and filters by requester", () => {
    const a = createBudgetRequest(db, base, "2026-10-01T00:00:00.000Z");
    const b = createBudgetRequest(db, { ...base, requesterEmail: "bo@corp.io" }, "2026-10-02T00:00:00.000Z");
    decideBudgetRequest(db, a.id, { status: "rejected", decidedBy: "admin@corp.io", note: "no" }, "2026-10-03T00:00:00.000Z");
    expect(listBudgetRequests(db).map((r) => r.id)).toEqual([b.id, a.id]);
    expect(listBudgetRequests(db, { requesterEmail: "ANA@corp.io" }).map((r) => r.id)).toEqual([a.id]);
  });

  it("decides only once", () => {
    const req = createBudgetRequest(db, base, "t");
    const decided = decideBudgetRequest(db, req.id, {
      status: "approved", decision: "top_up", grantedTokens: 200_000, decidedBy: "Admin@Corp.io", note: "ok",
    }, "2026-10-04T11:00:00.000Z");
    expect(decided).toMatchObject({
      status: "approved", decision: "top_up", grantedTokens: 200_000, decidedBy: "admin@corp.io",
      decisionNote: "ok", decidedAt: "2026-10-04T11:00:00.000Z",
    });
    expect(decideBudgetRequest(db, req.id, { status: "rejected", decidedBy: "x@corp.io" }, "t2")).toBeNull();
  });

  it("links the task", () => {
    const req = createBudgetRequest(db, base, "t");
    setBudgetRequestTask(db, req.id, "task-1");
    expect(getBudgetRequest(db, req.id)?.taskId).toBe("task-1");
  });
});
