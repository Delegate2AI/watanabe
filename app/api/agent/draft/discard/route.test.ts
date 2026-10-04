import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({}),
}));

const checkDraftAccessMock = vi.fn();
vi.mock("@/lib/agent/draft-access", () => ({
  checkDraftAccess: (...args: unknown[]) => checkDraftAccessMock(...args),
}));

const discardMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  discard: (...args: unknown[]) => discardMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent/draft/discard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  checkDraftAccessMock.mockReset();
  discardMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/agent/draft/discard", () => {
  it("401s when there is no identity, before touching draft access", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(post({ sessionId: "thread-1" }));
    expect(res.status).toBe(401);
    expect(checkDraftAccessMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(checkDraftAccessMock).not.toHaveBeenCalled();
  });

  it("403s on 'invalid-or-forbidden', without calling discard", async () => {
    checkDraftAccessMock.mockReturnValue("invalid-or-forbidden");
    const res = await POST(post({ sessionId: "thread-1" }));
    expect(res.status).toBe(403);
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("200s idempotently on 'own-but-gone', without calling discard", async () => {
    checkDraftAccessMock.mockReturnValue("own-but-gone");
    const res = await POST(post({ sessionId: "thread-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("200s and calls discard with the right id on 'own-and-live'", async () => {
    checkDraftAccessMock.mockReturnValue("own-and-live");
    const res = await POST(post({ sessionId: "thread-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(discardMock).toHaveBeenCalledWith("thread-1");
  });
});
