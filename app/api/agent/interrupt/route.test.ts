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

const getSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const ID = "11111111-1111-4111-8111-111111111111";

function post(sessionId: string = ID): Request {
  return new Request("http://localhost/api/agent/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  getSessionMock.mockReset().mockReturnValue(undefined);
});

describe("POST /api/agent/interrupt", () => {
  it("401s without an identity, before any ownership check", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(isOwnedByMock).not.toHaveBeenCalled();
  });

  it("404s a foreign id WITHOUT reaching the warm-session map", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await POST(post());
    expect(res.status).toBe(404);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("404s an unknown id IDENTICALLY to a foreign one (no existence oracle)", async () => {
    isOwnedByMock.mockReturnValue(false); // isOwnedBy is false for both foreign and unknown
    const foreign = await POST(post("22222222-2222-4222-8222-222222222222"));
    const unknown = await POST(post("33333333-3333-4333-8333-333333333333"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.json()).toEqual(await unknown.json());
  });

  it("is a graceful no-op for an owned but cold session", async () => {
    getSessionMock.mockReturnValue(undefined);
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, interrupted: false });
  });

  it("interrupts an owned, warm, ACTIVE session", async () => {
    const interrupt = vi.fn().mockResolvedValue(undefined);
    getSessionMock.mockReturnValue({ interrupt });
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(interrupt).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ ok: true, interrupted: true });
  });
});
