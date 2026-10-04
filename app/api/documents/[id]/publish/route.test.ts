import { beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const publishDocumentMock = vi.fn();
vi.mock("@/lib/documents/publish", () => ({
  publishDocument: (...args: unknown[]) => publishDocumentMock(...args),
}));

const { POST } = await import("./route");

const ALICE = { email: "alice@example.com", name: "Alice" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function request(body: unknown = {}) {
  return new Request("http://t/api/documents/d1/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  publishDocumentMock.mockReset();
});

describe("POST /api/documents/[id]/publish", () => {
  it("passes identity and mode through and returns the result", async () => {
    publishDocumentMock.mockResolvedValue({ ok: true, mode: "mr", branch: "b", mrUrl: "u", notePath: "docs/x.md" });
    const response = await POST(request({ mode: "mr" }), ctx("d1"));
    expect(response.status).toBe(200);
    expect(publishDocumentMock).toHaveBeenCalledWith(expect.anything(), {
      id: "d1",
      ownerEmail: ALICE.email,
      ownerName: ALICE.name,
      mode: "mr",
    });
    expect(await response.json()).toMatchObject({ ok: true, mrUrl: "u" });
  });

  it("defaults to mr mode", async () => {
    publishDocumentMock.mockResolvedValue({ ok: true, mode: "mr", branch: "b", mrUrl: "u", notePath: "docs/x.md" });
    await POST(request(), ctx("d1"));
    expect(publishDocumentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "mr" }));
  });

  it("keeps the failure status and reports a code, never the publisher's sentence", async () => {
    publishDocumentMock.mockResolvedValue({ ok: false, status: 409, error: "not ready" });
    const response = await POST(request({ mode: "direct" }), ctx("d1"));
    expect(response.status).toBe(409);
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({ error: { code: "wrong_status" } });
    expect(raw).not.toContain("not ready");
  });

  it("returns the identity failure without publishing", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "x" }, { status: 401 }) });
    expect((await POST(request(), ctx("d1"))).status).toBe(401);
    expect(publishDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    expect((await POST(request({ mode: "yolo" }), ctx("d1"))).status).toBe(400);
    expect(publishDocumentMock).not.toHaveBeenCalled();
  });
});
