import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const recordThreadMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  listThreadsForOwner: vi.fn(() => []),
  recordThread: (...args: unknown[]) => recordThreadMock(...args),
}));

const isAttachmentsEnabledMock = vi.fn();
vi.mock("@/lib/attachments/store", () => ({
  isAttachmentsEnabled: () => isAttachmentsEnabledMock(),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function post(): Request {
  return new Request("http://localhost/api/threads", { method: "POST" });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  recordThreadMock.mockReset();
  isAttachmentsEnabledMock.mockReset().mockReturnValue(true);
});

describe("POST /api/threads", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(recordThreadMock).not.toHaveBeenCalled();
  });

  it("404s and mints nothing when attachments are disabled", async () => {
    isAttachmentsEnabledMock.mockReturnValue(false);
    const res = await POST(post());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
    expect(recordThreadMock).not.toHaveBeenCalled();
  });

  it("mints a fresh uuid owned by the caller with no title", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(UUID);
    expect(recordThreadMock).toHaveBeenCalledWith(expect.anything(), body.id, "alice@example.com", undefined);
  });

  it("mints a different id every call", async () => {
    const first = (await (await POST(post())).json()) as { id: string };
    const second = (await (await POST(post())).json()) as { id: string };
    expect(first.id).not.toBe(second.id);
  });

  it("500s without leaking the store error when recording fails", async () => {
    recordThreadMock.mockImplementation(() => {
      throw new Error("disk full at /data/portal.db");
    });
    const res = await POST(post());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("/data/portal.db");
  });
});
