import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const listThreadsForOwnerMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  listThreadsForOwner: (...args: unknown[]) => listThreadsForOwnerMock(...args),
}));

const { GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function get(): Request {
  return new Request("http://localhost/api/threads");
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  listThreadsForOwnerMock.mockReset().mockReturnValue([]);
});

describe("GET /api/threads", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(listThreadsForOwnerMock).not.toHaveBeenCalled();
  });

  it("returns the caller's threads split into pinned + recent, newest first", async () => {
    listThreadsForOwnerMock.mockReturnValue([
      { sdkSessionId: "s1", title: "Recent chat", updatedAt: "2026-07-08T00:00:00.000Z", pinned: false },
      { sdkSessionId: "s2", title: null, updatedAt: "2026-07-07T00:00:00.000Z", pinned: true },
    ]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(listThreadsForOwnerMock).toHaveBeenCalledWith(expect.anything(), "alice@example.com");
    expect(await res.json()).toEqual({
      threads: [
        { id: "s1", title: "Recent chat", updatedAt: "2026-07-08T00:00:00.000Z", pinned: false },
        { id: "s2", title: "New chat", updatedAt: "2026-07-07T00:00:00.000Z", pinned: true },
      ],
    });
  });
});
