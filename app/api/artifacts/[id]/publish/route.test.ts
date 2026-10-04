import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...a: unknown[]) => requireIdentityMock(...a),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const publishArtifactMock = vi.fn();
vi.mock("@/lib/artifacts/publish", () => ({
  publishArtifact: (...a: unknown[]) => publishArtifactMock(...a),
}));

const { POST } = await import("./route");

const ALICE = { email: "alice@example.com", name: "Alice" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown = {}) {
  return new Request("http://t/api/artifacts/a1/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  publishArtifactMock.mockReset();
});

describe("POST /api/artifacts/[id]/publish", () => {
  it("passes the caller's identity and mode through, returning the publish result", async () => {
    publishArtifactMock.mockResolvedValue({ ok: true, mode: "mr", branch: "b", mrUrl: "u", notePath: "docs/x.md" });
    const res = await POST(req({ mode: "mr" }), ctx("a1"));
    expect(res.status).toBe(200);
    expect(publishArtifactMock).toHaveBeenCalledWith(expect.anything(), {
      id: "a1",
      ownerEmail: ALICE.email,
      ownerName: ALICE.name,
      mode: "mr",
    });
    expect(await res.json()).toMatchObject({ ok: true, mrUrl: "u" });
  });

  it("defaults to mr mode when none is given", async () => {
    publishArtifactMock.mockResolvedValue({ ok: true, mode: "mr", branch: "b", mrUrl: "u", notePath: "docs/x.md" });
    await POST(req({}), ctx("a1"));
    expect(publishArtifactMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "mr" }));
  });

  it("maps a failure result to its status", async () => {
    publishArtifactMock.mockResolvedValue({ ok: false, status: 403, error: "denied" });
    const res = await POST(req({ mode: "direct" }), ctx("a1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("401 with no identity, without ever calling publish", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "x" }, { status: 401 }) });
    const res = await POST(req({}), ctx("a1"));
    expect(res.status).toBe(401);
    expect(publishArtifactMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode with 400", async () => {
    const res = await POST(req({ mode: "yolo" }), ctx("a1"));
    expect(res.status).toBe(400);
    expect(publishArtifactMock).not.toHaveBeenCalled();
  });
});
