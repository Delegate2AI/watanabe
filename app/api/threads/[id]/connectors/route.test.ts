import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const listThreadConnectorsMock = vi.fn();
const setThreadConnectorMock = vi.fn();
vi.mock("@/lib/db/thread-connectors", () => ({
  listThreadConnectors: (...args: unknown[]) => listThreadConnectorsMock(...args),
  setThreadConnector: (...args: unknown[]) => setThreadConnectorMock(...args),
}));

// `dropWarmSessionSoon`, not `dropWarmSession`: the eviction has to survive a
// BUSY session, or a connector disabled mid-answer never takes effect at all.
const dropWarmSessionSoonMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  dropWarmSessionSoon: (...args: unknown[]) => dropWarmSessionSoonMock(...args),
}));

const isConnectorsEnabledMock = vi.fn();
vi.mock("@/lib/connectors/config", () => ({
  isConnectorsEnabled: () => isConnectorsEnabledMock(),
}));

const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const resolveClearanceForEmailMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (...args: unknown[]) => resolveClearanceForEmailMock(...args),
}));

const { GET, PUT } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

const REGISTRY = {
  entries: [
    { slug: "linear", title: "Linear", transport: "http", url: "https://l.example", groups: ["eng"] },
    { slug: "payroll", title: "Payroll", transport: "http", url: "https://p.example", groups: ["finance"] },
  ],
  errors: [],
};

function get(id: string): Request {
  return new Request(`http://localhost/api/threads/${id}/connectors`);
}

function put(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/threads/${id}/connectors`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  listThreadConnectorsMock.mockReset().mockReturnValue(["linear"]);
  setThreadConnectorMock.mockReset().mockReturnValue(true);
  dropWarmSessionSoonMock.mockReset();
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue(REGISTRY);
  resolveClearanceForEmailMock.mockReset().mockReturnValue(["all-hands", "eng"]);
});

describe("GET /api/threads/[id]/connectors", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await GET(get("s1"), ctx("s1"));
    expect(res.status).toBe(401);
    expect(listThreadConnectorsMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off (dark route)", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    const res = await GET(get("s1"), ctx("s1"));
    expect(res.status).toBe(404);
    expect(listThreadConnectorsMock).not.toHaveBeenCalled();
  });

  it("404s a foreign or unknown thread (no existence oracle)", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await GET(get("s1"), ctx("s1"));
    expect(res.status).toBe(404);
    expect(listThreadConnectorsMock).not.toHaveBeenCalled();
  });

  it("returns the thread's enabled slugs", async () => {
    const res = await GET(get("s1"), ctx("s1"));
    expect(res.status).toBe(200);
    expect(isOwnedByMock).toHaveBeenCalledWith(expect.anything(), "s1", "alice@example.com");
    expect(await res.json()).toEqual({ enabled: ["linear"] });
  });
});

describe("PUT /api/threads/[id]/connectors", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await PUT(put("s1", { slug: "linear", enabled: true }), ctx("s1"));
    expect(res.status).toBe(401);
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off (dark route)", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    const res = await PUT(put("s1", { slug: "linear", enabled: true }), ctx("s1"));
    expect(res.status).toBe(404);
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("400s a malformed body, never touching the store", async () => {
    const res = await PUT(put("s1", { slug: "linear", enabled: "yes" }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "body" } });
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("404s a thread owned by someone else, before validating the slug", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await PUT(put("s1", { slug: "linear", enabled: true }), ctx("s1"));
    expect(res.status).toBe(404);
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("400s a slug the registry does not know", async () => {
    const res = await PUT(put("s1", { slug: "nope", enabled: true }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "slug" } });
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("400s a registered slug the caller is not cleared for (indistinguishable from unknown)", async () => {
    const res = await PUT(put("s1", { slug: "payroll", enabled: true }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "slug" } });
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("toggles a cleared slug, drops the warm session, and returns the updated list", async () => {
    listThreadConnectorsMock.mockReturnValue(["linear"]);
    const res = await PUT(put("s1", { slug: "linear", enabled: true }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(setThreadConnectorMock).toHaveBeenCalledWith(expect.anything(), "s1", "linear", true);
    expect(dropWarmSessionSoonMock).toHaveBeenCalledWith("s1");
    expect(await res.json()).toEqual({ enabled: ["linear"] });
  });

  it("disables a cleared slug and returns the shrunken list", async () => {
    listThreadConnectorsMock.mockReturnValue([]);
    const res = await PUT(put("s1", { slug: "linear", enabled: false }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(setThreadConnectorMock).toHaveBeenCalledWith(expect.anything(), "s1", "linear", false);
    expect(dropWarmSessionSoonMock).toHaveBeenCalledWith("s1");
    expect(await res.json()).toEqual({ enabled: [] });
  });

  it("does not evict a warm session on a no-op toggle (already in the requested state)", async () => {
    setThreadConnectorMock.mockReturnValue(false);
    const res = await PUT(put("s1", { slug: "linear", enabled: true }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(dropWarmSessionSoonMock).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ enabled: ["linear"] });
  });
});
