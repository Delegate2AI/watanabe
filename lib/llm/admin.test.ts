import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { listBudgets } from "@/lib/db/llm-budgets";
import { listModelGroups } from "@/lib/db/llm-groups";
import { getLlmKey, insertLlmKey } from "@/lib/db/llm-keys";
import { removeBudget, removeModelGroup, revokeAllKeys, saveBudget, saveModelGroup, type AdminCtx } from "./admin";

let db: DatabaseType;
let ctx: AdminCtx;
let notify: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  db = openDb(":memory:");
  notify = vi.fn<() => Promise<void>>(async () => undefined);
  ctx = { db, actorEmail: "admin@corp.io", groups: { eng: ["ana@corp.io"] }, admin: null, notify };
});

const group = { slug: "paid", label: "Paid", models: ["anthropic/*"], defaultTokens: 100_000, period: "month" };

describe("model groups", () => {
  it("saves a valid group and tells the gate", async () => {
    expect(await saveModelGroup(ctx, group)).toEqual({ ok: true, value: null });
    expect(listModelGroups(db)).toEqual([group]);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("rejects a bad slug, period or token count, naming the field", async () => {
    expect(await saveModelGroup(ctx, { ...group, slug: "Has Space" })).toMatchObject({ ok: false, code: "invalid_request", detail: "slug" });
    expect(await saveModelGroup(ctx, { ...group, period: "year" })).toMatchObject({ ok: false, detail: "period" });
    expect(await saveModelGroup(ctx, { ...group, defaultTokens: -1 })).toMatchObject({ ok: false, detail: "defaultTokens" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("removes a group together with its budget rows", async () => {
    await saveModelGroup(ctx, group);
    await saveBudget(ctx, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: 5, period: "day", allowed: true });
    expect(await removeModelGroup(ctx, "paid")).toEqual({ ok: true, value: null });
    expect(listBudgets(db)).toEqual([]);
    expect(await removeModelGroup(ctx, "paid")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("budgets", () => {
  beforeEach(async () => {
    await saveModelGroup(ctx, group);
    notify.mockClear();
  });

  it("refuses a budget for a group that does not exist", async () => {
    expect(await saveBudget(ctx, { subjectKind: "team", subject: "eng", groupSlug: "ghost", tokens: 1, period: "day", allowed: true }))
      .toMatchObject({ ok: false, detail: "groupSlug" });
  });

  it("saves team rows for known teams and all-hands only", async () => {
    expect((await saveBudget(ctx, { subjectKind: "team", subject: "eng", groupSlug: "paid", tokens: null, period: "week", allowed: true })).ok).toBe(true);
    expect((await saveBudget(ctx, { subjectKind: "team", subject: "all-hands", groupSlug: "paid", tokens: 0, period: "week", allowed: false })).ok).toBe(true);
    expect(await saveBudget(ctx, { subjectKind: "team", subject: "ghosts", groupSlug: "paid", tokens: 1, period: "day", allowed: true }))
      .toMatchObject({ ok: false, detail: "subject" });
  });

  it("stores a user row by lowercased address and deletes it", async () => {
    await saveBudget(ctx, { subjectKind: "user", subject: "Ana@Corp.io", groupSlug: "paid", tokens: 9, period: "day", allowed: true });
    expect(listBudgets(db)[0]).toMatchObject({ subjectKind: "user", subject: "ana@corp.io" });
    expect((await removeBudget(ctx, { subjectKind: "user", subject: "ana@corp.io", groupSlug: "paid" })).ok).toBe(true);
    expect(await saveBudget(ctx, { subjectKind: "user", subject: "not-an-email", groupSlug: "paid", tokens: 9, period: "day", allowed: true }))
      .toMatchObject({ ok: false, detail: "subject" });
  });
});

describe("revokeAllKeys", () => {
  it("revokes every active key of one person and tells the gate once", async () => {
    const a = insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-1111", label: "a" });
    const b = insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r2", key: "k-2222", label: "b" });
    const other = insertLlmKey(db, { ownerEmail: "bo@corp.io", routerKeyId: "r3", key: "k-3333", label: "c" });
    expect(await revokeAllKeys(ctx, "ANA@corp.io")).toEqual({ ok: true, value: { revoked: 2 } });
    expect([getLlmKey(db, a.id)?.status, getLlmKey(db, b.id)?.status, getLlmKey(db, other.id)?.status]).toEqual(["revoked", "revoked", "active"]);
    expect(notify).toHaveBeenCalledOnce();
  });
});
