import { describe, it, expect, vi, beforeEach } from "vitest";

// Every dependency is mocked — this is a unit test of the route's own
// branching (401/400/403/404/200), not an integration test of identity,
// ownership, or AgentSession internals (each has its own test suite).

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({}),
}));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const getSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  getSessionMock.mockReset();
});

describe("POST /api/agent/permission", () => {
  it("401s when there is no identity, before touching ownership or the session", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(post({ sessionId: SESSION_ID, requestId: REQUEST_ID, decision: "allow" }));
    expect(res.status).toBe(401);
    expect(isOwnedByMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body", async () => {
    const res = await POST(post({ sessionId: "not-a-uuid", requestId: REQUEST_ID, decision: "allow" }));
    expect(res.status).toBe(400);
  });

  it("403s when the thread does not belong to the caller, before looking up the session", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await POST(post({ sessionId: SESSION_ID, requestId: REQUEST_ID, decision: "allow" }));
    expect(res.status).toBe(403);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("404s when there is no warm session for the (owned) thread", async () => {
    getSessionMock.mockReturnValue(undefined);
    const res = await POST(post({ sessionId: SESSION_ID, requestId: REQUEST_ID, decision: "allow" }));
    expect(res.status).toBe(404);
  });

  it("404s when the session exists but the requestId is unknown/already resolved", async () => {
    const resolvePermission = vi.fn().mockReturnValue(false);
    getSessionMock.mockReturnValue({ resolvePermission });
    const res = await POST(post({ sessionId: SESSION_ID, requestId: REQUEST_ID, decision: "deny" }));
    expect(res.status).toBe(404);
    expect(resolvePermission).toHaveBeenCalledWith(REQUEST_ID, "deny");
  });

  it("200s and resolves the permission when everything checks out", async () => {
    const resolvePermission = vi.fn().mockReturnValue(true);
    getSessionMock.mockReturnValue({ resolvePermission });
    const res = await POST(post({ sessionId: SESSION_ID, requestId: REQUEST_ID, decision: "allow" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resolvePermission).toHaveBeenCalledWith(REQUEST_ID, "allow");
  });
});
