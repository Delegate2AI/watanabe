import { describe, it, expect, vi, beforeEach } from "vitest";

// Every dependency is mocked, mirroring app/api/agent/permission/route.test.ts:
// this is a unit test of the route's own branching (401/403/200/skipped), not
// an integration test of identity, ownership, or the dream pipeline (each has
// its own test suite).

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

const markDreamedMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  markDreamed: (...args: unknown[]) => markDreamedMock(...args),
}));

const isMemoryEnabledMock = vi.fn();
vi.mock("@/lib/memory/config", () => ({
  isMemoryEnabled: () => isMemoryEnabledMock(),
}));

const readTranscriptTextMock = vi.fn();
vi.mock("@/lib/memory/transcript", () => ({
  readTranscriptText: (...args: unknown[]) => readTranscriptTextMock(...args),
}));

const runDreamMock = vi.fn();
vi.mock("@/lib/memory/dream", () => ({
  runDream: (...args: unknown[]) => runDreamMock(...args),
}));

// Spec 32: the route resolves the caller's clearance server-side and hands it
// to the dream, which scopes its shared-memory writes to those groups.
// Returns clearance only for a non-empty email, mirroring the real resolver's
// shape closely enough that the route's argument is actually exercised.
const resolveClearanceForEmailMock = vi.fn((email: string) => (email ? ["all-hands", "finance"] : []));
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (email: string) => resolveClearanceForEmailMock(email),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent/memory/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  markDreamedMock.mockReset();
  isMemoryEnabledMock.mockReset().mockReturnValue(true);
  readTranscriptTextMock.mockReset().mockResolvedValue("USER: hi\n\nASSISTANT: hello");
  runDreamMock.mockReset().mockResolvedValue("committed");
});

describe("POST /api/agent/memory/end", () => {
  it("runs consolidation for an owned thread, marks it dreamed, and returns its status", async () => {
    const res = await POST(post({ sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "committed" });
    expect(runDreamMock).toHaveBeenCalledWith({
      sdkSessionId: SESSION_ID,
      ownerEmail: IDENTITY.email,
      ownerName: IDENTITY.name,
      transcript: "USER: hi\n\nASSISTANT: hello",
      clearance: ["all-hands", "finance"],
    });
    expect(markDreamedMock).toHaveBeenCalledWith({}, SESSION_ID);
  });

  it("resolves clearance from the authenticated identity, not from the request body", async () => {
    await POST(post({ sessionId: SESSION_ID, clearance: ["admins"] } as Record<string, unknown>));
    expect(resolveClearanceForEmailMock).toHaveBeenCalledWith(IDENTITY.email);
    expect(runDreamMock.mock.calls[0][0].clearance).toEqual(["all-hands", "finance"]);
  });

  it("403s when the thread does not belong to the caller, before running the dream", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await POST(post({ sessionId: SESSION_ID }));
    expect(res.status).toBe(403);
    expect(runDreamMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity, before touching ownership", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(post({ sessionId: SESSION_ID }));
    expect(res.status).toBe(401);
    expect(isOwnedByMock).not.toHaveBeenCalled();
  });

  it("returns skipped without running the dream when memory is disabled", async () => {
    isMemoryEnabledMock.mockReturnValue(false);
    const res = await POST(post({ sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped" });
    expect(runDreamMock).not.toHaveBeenCalled();
    expect(markDreamedMock).not.toHaveBeenCalled();
  });

  it("does not mark the thread dreamed when the dream fails", async () => {
    runDreamMock.mockResolvedValue("failed");
    const res = await POST(post({ sessionId: SESSION_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "failed" });
    expect(markDreamedMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body", async () => {
    const res = await POST(post({ sessionId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });
});
