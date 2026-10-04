import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { listModelGroups, upsertModelGroup } from "@/lib/db/llm-groups";
import { getLlmKey, listLlmKeys } from "@/lib/db/llm-keys";
import { log } from "@/lib/log";
import { createLlmKey, revokeLlmKeyFor } from "./keys";
import { RouterAdminError, type RouterAdmin } from "./router-admin";

let db: DatabaseType;
let admin: {
  createKey: ReturnType<typeof vi.fn<RouterAdmin["createKey"]>>;
  deleteKey: ReturnType<typeof vi.fn<RouterAdmin["deleteKey"]>>;
};

beforeEach(() => {
  db = openDb(":memory:");
  admin = {
    createKey: vi.fn<RouterAdmin["createKey"]>(async () => ({ id: "rk1", key: "sk-9r-wxyz" })),
    deleteKey: vi.fn<RouterAdmin["deleteKey"]>(async () => undefined),
  };
});

const deps = () => ({ db, admin, notify: vi.fn(async () => undefined) });

describe("createLlmKey", () => {
  it("names the 9router key after the owner and label and returns the raw key once", async () => {
    const d = deps();
    const out = await createLlmKey(d, { ownerEmail: "Ana@Corp.io", label: " laptop " });
    expect(admin.createKey).toHaveBeenCalledWith("ana@corp.io laptop");
    expect(d.notify).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ ok: true, value: { key: "sk-9r-wxyz", record: { keyHint: "wxyz", label: "laptop" } } });
    expect(JSON.stringify(listLlmKeys(db, "ana@corp.io"))).not.toContain("sk-9r-wxyz");
  });

  it("rejects an empty or overlong label without calling 9router", async () => {
    expect(await createLlmKey(deps(), { ownerEmail: "a@x.io", label: "  " })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(await createLlmKey(deps(), { ownerEmail: "a@x.io", label: "x".repeat(61) })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(admin.createKey).not.toHaveBeenCalled();
  });

  it("answers llm_unavailable and writes nothing when 9router is not configured or refuses", async () => {
    expect(await createLlmKey({ db, admin: null }, { ownerEmail: "a@x.io", label: "l" })).toMatchObject({ ok: false, code: "llm_unavailable" });
    admin.createKey.mockRejectedValueOnce(new RouterAdminError("9router login refused (401)"));
    expect(await createLlmKey(deps(), { ownerEmail: "a@x.io", label: "l" })).toMatchObject({ ok: false, code: "llm_unavailable" });
    expect(listLlmKeys(db, "a@x.io")).toEqual([]);
  });
});

describe("default budget on first key", () => {
  it("creates a catch-all group at 5M tokens a day when no model group exists yet", async () => {
    await createLlmKey(deps(), { ownerEmail: "ana@corp.io", label: "laptop" });
    expect(listModelGroups(db)).toEqual([
      { slug: "default", label: "All models", models: ["*"], defaultTokens: 5_000_000, period: "day" },
    ]);
  });

  it("leaves the admin's groups alone when any exist", async () => {
    upsertModelGroup(db, { slug: "local", label: "Local", models: ["ollama/*"], defaultTokens: null, period: "day" });
    await createLlmKey(deps(), { ownerEmail: "ana@corp.io", label: "laptop" });
    expect(listModelGroups(db).map((g) => g.slug)).toEqual(["local"]);
  });

  it("does not seed when key creation fails", async () => {
    admin.createKey.mockRejectedValueOnce(new RouterAdminError("down"));
    await createLlmKey(deps(), { ownerEmail: "ana@corp.io", label: "laptop" });
    expect(listModelGroups(db)).toEqual([]);
  });
});

describe("revokeLlmKeyFor", () => {
  async function seed(): Promise<string> {
    const out = await createLlmKey(deps(), { ownerEmail: "ana@corp.io", label: "laptop" });
    if (!out.ok) throw new Error("seed failed");
    return out.value.record.id;
  }

  it("revokes the owner's key, deletes it in 9router, and tells the gate", async () => {
    const id = await seed();
    const d = deps();
    expect(await revokeLlmKeyFor(d, { id, ownerEmail: "ANA@corp.io" })).toEqual({ ok: true, value: null });
    expect(getLlmKey(db, id)?.status).toBe("revoked");
    expect(admin.deleteKey).toHaveBeenCalledWith("rk1");
    expect(d.notify).toHaveBeenCalledOnce();
  });

  it("hides somebody else's key as not found", async () => {
    const id = await seed();
    expect(await revokeLlmKeyFor(deps(), { id, ownerEmail: "bo@corp.io" })).toMatchObject({ ok: false, code: "not_found" });
    expect(getLlmKey(db, id)?.status).toBe("active");
  });

  it("lets an admin-scoped call revoke any key", async () => {
    const id = await seed();
    expect(await revokeLlmKeyFor(deps(), { id, ownerEmail: null })).toEqual({ ok: true, value: null });
    expect(getLlmKey(db, id)?.status).toBe("revoked");
  });

  it("still revokes when 9router is down", async () => {
    const id = await seed();
    admin.deleteKey.mockRejectedValueOnce(new RouterAdminError("9router unreachable"));
    const d = deps();
    expect(await revokeLlmKeyFor(d, { id, ownerEmail: "ana@corp.io" })).toEqual({ ok: true, value: null });
    expect(getLlmKey(db, id)?.status).toBe("revoked");
    expect(d.notify).toHaveBeenCalledOnce();
  });

  it("revokes and logs when 9router is not configured", async () => {
    const id = await seed();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    expect(await revokeLlmKeyFor({ db, admin: null, notify: async () => undefined }, { id, ownerEmail: "ana@corp.io" }))
      .toEqual({ ok: true, value: null });
    expect(getLlmKey(db, id)?.status).toBe("revoked");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not configured"), { id });
    warn.mockRestore();
  });

  it("is idempotent for an already revoked key", async () => {
    const id = await seed();
    await revokeLlmKeyFor(deps(), { id, ownerEmail: "ana@corp.io" });
    admin.deleteKey.mockClear();
    expect(await revokeLlmKeyFor(deps(), { id, ownerEmail: "ana@corp.io" })).toEqual({ ok: true, value: null });
    expect(admin.deleteKey).not.toHaveBeenCalled();
  });
});
