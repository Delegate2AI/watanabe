import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { listBudgets, setBudget } from "@/lib/db/llm-budgets";
import { upsertModelGroup } from "@/lib/db/llm-groups";
import { getBudgetRequest } from "@/lib/db/llm-requests";
import { getUsage } from "@/lib/db/llm-usage";
import { listComments } from "@/lib/db/task-comments";
import { decideRequest, requestMoreTokens, type RequestCtx } from "./requests";

let db: DatabaseType;
let ctx: RequestCtx;
let notify: ReturnType<typeof vi.fn<() => Promise<void>>>;
const NOW = new Date("2026-10-04T12:00:00.000Z");

function task(id: string) {
  return db.prepare(`SELECT title, description, status, assignees, clearance, created_by AS createdBy FROM tasks WHERE id = ?`).get(id) as {
    title: string; description: string; status: string; assignees: string; clearance: string; createdBy: string;
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  notify = vi.fn<() => Promise<void>>(async () => undefined);
  ctx = { db, groups: { admins: ["boss@corp.io"], eng: ["ana@corp.io"] }, now: () => NOW, notify, approvers: () => ["boss@corp.io"] };
  upsertModelGroup(db, { slug: "paid", label: "Paid models", models: ["anthropic/*"], defaultTokens: 1000, period: "month" });
});

function ask(over: Record<string, unknown> = {}) {
  const out = requestMoreTokens(ctx, { requesterEmail: "Ana@Corp.io", groupSlug: "paid", tokens: 5000, reason: "release week", ...over });
  if (!out.ok) throw new Error(`request failed: ${out.code}`);
  return out.value;
}

describe("requestMoreTokens", () => {
  it("records the request and opens a task for the approvers, visible to admins", () => {
    const req = ask();
    expect(req).toMatchObject({ requesterEmail: "ana@corp.io", status: "pending", requestedTokens: 5000 });
    const t = task(req.taskId!);
    expect(t.title).toBe("LLM budget: ana@corp.io wants +5,000 tokens for Paid models");
    expect(t.description).toContain("release week");
    expect(t.description).toContain("/admin/llm#requests");
    expect(JSON.parse(t.assignees)).toEqual(["boss@corp.io"]);
    expect(JSON.parse(t.clearance)).toEqual(["admins"]);
    expect(t.createdBy).toBe("ana@corp.io");
  });

  it("rejects an unknown group, a non-positive amount and an empty reason", () => {
    expect(requestMoreTokens(ctx, { requesterEmail: "a@x.io", groupSlug: "nope", tokens: 1, reason: "r" })).toMatchObject({ ok: false, detail: "groupSlug" });
    expect(requestMoreTokens(ctx, { requesterEmail: "a@x.io", groupSlug: "paid", tokens: 0, reason: "r" })).toMatchObject({ ok: false, detail: "tokens" });
    expect(requestMoreTokens(ctx, { requesterEmail: "a@x.io", groupSlug: "paid", tokens: 1.5, reason: "r" })).toMatchObject({ ok: false, detail: "tokens" });
    expect(requestMoreTokens(ctx, { requesterEmail: "a@x.io", groupSlug: "paid", tokens: 1, reason: "  " })).toMatchObject({ ok: false, detail: "reason" });
  });
});

describe("decideRequest", () => {
  it("tops up the current period, comments on the task and completes it", async () => {
    const req = ask();
    const out = await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "approve_top_up", tokens: 2000, note: "go" });
    expect(out).toMatchObject({ ok: true, value: { status: "approved", decision: "top_up", grantedTokens: 2000 } });
    expect(getUsage(db, "ana@corp.io", "paid", "2026-10-01").bonusTokens).toBe(2000);
    expect(task(req.taskId!).status).toBe("done");
    expect(listComments(db, req.taskId!)[0].body).toContain("+2,000 tokens for this month");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("raises the limit permanently from the current resolved limit, in its period", async () => {
    setBudget(db, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 10_000, period: "week", allowed: true, updatedBy: "x" });
    const req = ask();
    await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "approve_permanent" });
    expect(listBudgets(db).find((b) => b.subjectKind === "user")).toEqual({
      subjectKind: "user", subject: "ana@corp.io", groupSlug: "paid", tokens: 15_000, period: "week", allowed: true,
    });
  });

  it("rejects with a note and changes no budget", async () => {
    const req = ask();
    await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "reject", note: "not this month" });
    expect(getBudgetRequest(db, req.id)).toMatchObject({ status: "rejected", decisionNote: "not this month" });
    expect(listBudgets(db)).toEqual([]);
    expect(listComments(db, req.taskId!)[0].body).toContain("not this month");
  });

  it("decides once, and answers not_found for an unknown id", async () => {
    const req = ask();
    await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "reject" });
    expect(await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "approve_top_up" })).toMatchObject({ ok: false, code: "conflict" });
    expect(await decideRequest(ctx, { id: "nope", actorEmail: "boss@corp.io", action: "reject" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("answers not_found and leaves the request pending when its group was deleted", async () => {
    const req = ask();
    db.prepare(`DELETE FROM llm_model_groups WHERE slug = 'paid'`).run();
    expect(await decideRequest(ctx, { id: req.id, actorEmail: "boss@corp.io", action: "approve_top_up" })).toMatchObject({ ok: false, code: "not_found" });
    expect(getBudgetRequest(db, req.id)?.status).toBe("pending");
  });

  it("refuses an unknown action or a bad amount", async () => {
    const req = ask();
    expect(await decideRequest(ctx, { id: req.id, actorEmail: "b@x.io", action: "maybe" })).toMatchObject({ ok: false, detail: "action" });
    expect(await decideRequest(ctx, { id: req.id, actorEmail: "b@x.io", action: "approve_top_up", tokens: -5 })).toMatchObject({ ok: false, detail: "tokens" });
  });
});
