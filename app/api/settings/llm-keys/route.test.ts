import { beforeEach, describe, expect, it, vi } from "vitest";

let enabled = true;
let member = true;
let identity: { email: string } | null = { email: "ana@corp.io" };

vi.mock("@/lib/llm/config", () => ({ isLlmKeysEnabled: () => enabled }));
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: async () => (identity ? { identity } : { response: new Response(null, { status: 401 }) }),
}));
vi.mock("@/lib/authority/groups", () => ({ isKnownMember: () => member, loadGroups: () => ({}) }));
vi.mock("@/lib/authority/aliases", async (orig) => ({
  ...(await orig<typeof import("@/lib/authority/aliases")>()),
  aliasIndex: () => ({ "ana.alias@corp.io": "ana@corp.io" }),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/llm/router-admin", () => ({ getRouterAdmin: () => ({}) }));
const listMock = vi.fn<(...a: unknown[]) => unknown[]>(() => [{ id: "k1" }]);
vi.mock("@/lib/db/llm-keys", () => ({ listLlmKeys: (...a: unknown[]) => listMock(...a) }));
const createMock = vi.fn();
const revokeMock = vi.fn();
vi.mock("@/lib/llm/keys", () => ({
  createLlmKey: (...a: unknown[]) => createMock(...a),
  revokeLlmKeyFor: (...a: unknown[]) => revokeMock(...a),
}));

const { GET, POST, DELETE } = await import("./route");
const url = "http://localhost/api/settings/llm-keys";

beforeEach(() => {
  enabled = true;
  member = true;
  identity = { email: "ana@corp.io" };
  listMock.mockClear();
  createMock.mockReset();
  revokeMock.mockReset();
});

describe("/api/settings/llm-keys", () => {
  it("404s with the flag off or for a non-member, 401s without identity", async () => {
    enabled = false;
    expect((await GET(new Request(url))).status).toBe(404);
    enabled = true;
    member = false;
    expect((await GET(new Request(url))).status).toBe(404);
    identity = null;
    expect((await GET(new Request(url))).status).toBe(401);
  });

  it("lists only the caller's keys", async () => {
    const res = await GET(new Request(url));
    expect(await res.json()).toEqual({ keys: [{ id: "k1" }] });
    expect(listMock).toHaveBeenCalledWith({}, "ana@corp.io");
  });

  it("creates a key and returns it with 201", async () => {
    createMock.mockResolvedValue({ ok: true, value: { key: "sk", record: { id: "k2" } } });
    const res = await POST(new Request(url, { method: "POST", body: JSON.stringify({ label: "laptop" }) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key: "sk", record: { id: "k2" } });
    expect(createMock).toHaveBeenCalledWith({ db: {}, admin: {} }, { ownerEmail: "ana@corp.io", label: "laptop" });
  });

  it("answers 503 when the gateway is unavailable", async () => {
    createMock.mockResolvedValue({ ok: false, code: "llm_unavailable" });
    const res = await POST(new Request(url, { method: "POST", body: JSON.stringify({ label: "x" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "llm_unavailable" } });
  });

  it("resolves an alias sign-in to the canonical owner", async () => {
    identity = { email: "Ana.Alias@corp.io" };
    await GET(new Request(url));
    expect(listMock).toHaveBeenCalledWith({}, "ana@corp.io");
  });

  it("400s a body without a string label", async () => {
    const res = await POST(new Request(url, { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("revokes by id, scoped to the caller", async () => {
    revokeMock.mockResolvedValue({ ok: true, value: null });
    const res = await DELETE(new Request(`${url}?id=k1`, { method: "DELETE" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(revokeMock).toHaveBeenCalledWith({ db: {}, admin: {} }, { id: "k1", ownerEmail: "ana@corp.io" });
  });

  it("400s a revoke without an id", async () => {
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(400);
  });
});
