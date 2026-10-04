import { beforeEach, describe, expect, it, vi } from "vitest";

let enabled = true;
let admin = true;
let identity: { email: string } | null = { email: "Boss@corp.io" };

vi.mock("@/lib/llm/config", () => ({ isLlmKeysEnabled: () => enabled }));
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: async () => (identity ? { identity } : { response: new Response(null, { status: 401 }) }),
}));
vi.mock("@/lib/authority/roles", () => ({ can: () => admin }));
vi.mock("@/lib/authority/aliases", () => ({ aliasIndex: () => ({}), canonicalEmail: (e: string) => e.toLowerCase() }));
vi.mock("@/lib/authority/groups", () => ({ loadGroups: () => ({ eng: ["ana@corp.io"] }), isKnownMember: () => true }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/llm/router-admin", () => ({ getRouterAdmin: () => null }));

const svc = {
  saveModelGroup: vi.fn(), removeModelGroup: vi.fn(), saveBudget: vi.fn(), removeBudget: vi.fn(),
  revokeAllKeys: vi.fn(), revokeLlmKeyFor: vi.fn(), decideRequest: vi.fn(),
};
vi.mock("@/lib/llm/admin", () => ({
  saveModelGroup: (...a: unknown[]) => svc.saveModelGroup(...a),
  removeModelGroup: (...a: unknown[]) => svc.removeModelGroup(...a),
  saveBudget: (...a: unknown[]) => svc.saveBudget(...a),
  removeBudget: (...a: unknown[]) => svc.removeBudget(...a),
  revokeAllKeys: (...a: unknown[]) => svc.revokeAllKeys(...a),
}));
vi.mock("@/lib/llm/keys", () => ({ revokeLlmKeyFor: (...a: unknown[]) => svc.revokeLlmKeyFor(...a) }));
vi.mock("@/lib/llm/requests", () => ({ decideRequest: (...a: unknown[]) => svc.decideRequest(...a) }));

const groups = await import("./groups/route");
const budgets = await import("./budgets/route");
const keys = await import("./keys/route");
const requests = await import("./requests/route");

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  enabled = true;
  admin = true;
  identity = { email: "Boss@corp.io" };
  for (const fn of Object.values(svc)) fn.mockReset().mockResolvedValue({ ok: true, value: null });
});

describe("/api/admin/llm/*", () => {
  it("404s with the flag off or for a non-admin, 401s without identity, before any service call", async () => {
    enabled = false;
    expect((await groups.PUT(json("PUT", "/api/admin/llm/groups", {}))).status).toBe(404);
    enabled = true;
    admin = false;
    expect((await budgets.PUT(json("PUT", "/api/admin/llm/budgets", {}))).status).toBe(404);
    identity = null;
    expect((await requests.POST(json("POST", "/api/admin/llm/requests", { id: "r" }))).status).toBe(401);
    expect(svc.saveModelGroup).not.toHaveBeenCalled();
    expect(svc.saveBudget).not.toHaveBeenCalled();
    expect(svc.decideRequest).not.toHaveBeenCalled();
  });

  it("saves and deletes model groups as the canonical admin", async () => {
    await groups.PUT(json("PUT", "/api/admin/llm/groups", { slug: "paid" }));
    expect(svc.saveModelGroup).toHaveBeenCalledWith(expect.objectContaining({ actorEmail: "boss@corp.io" }), { slug: "paid" });
    await groups.DELETE(json("DELETE", "/api/admin/llm/groups?slug=paid"));
    expect(svc.removeModelGroup).toHaveBeenCalledWith(expect.anything(), "paid");
    expect((await groups.DELETE(json("DELETE", "/api/admin/llm/groups"))).status).toBe(400);
  });

  it("passes a service failure through as its status", async () => {
    svc.saveBudget.mockResolvedValue({ ok: false, code: "invalid_request", detail: "subject" });
    const res = await budgets.PUT(json("PUT", "/api/admin/llm/budgets", { subject: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "subject" } });
  });

  it("revokes one key by id or every key of an owner", async () => {
    expect(await (await keys.DELETE(json("DELETE", "/api/admin/llm/keys?id=k1"))).json()).toEqual({ ok: true });
    expect(svc.revokeLlmKeyFor).toHaveBeenCalledWith(expect.anything(), { id: "k1", ownerEmail: null });
    svc.revokeAllKeys.mockResolvedValue({ ok: true, value: { revoked: 2 } });
    expect(await (await keys.DELETE(json("DELETE", "/api/admin/llm/keys?owner=ana@corp.io"))).json()).toEqual({ revoked: 2 });
    expect((await keys.DELETE(json("DELETE", "/api/admin/llm/keys"))).status).toBe(400);
  });

  it("decides a request", async () => {
    svc.decideRequest.mockResolvedValue({ ok: true, value: { id: "r1", status: "approved" } });
    const res = await requests.POST(json("POST", "/api/admin/llm/requests", { id: "r1", action: "approve_top_up", tokens: 5 }));
    expect(await res.json()).toEqual({ request: { id: "r1", status: "approved" } });
    expect(svc.decideRequest).toHaveBeenCalledWith(expect.anything(), {
      id: "r1", actorEmail: "boss@corp.io", action: "approve_top_up", tokens: 5, note: undefined,
    });
    expect((await requests.POST(json("POST", "/api/admin/llm/requests", {}))).status).toBe(400);
  });
});
