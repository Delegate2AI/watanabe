import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const setThreadPinnedMock = vi.fn();
const setThreadTitleMock = vi.fn();
const deleteThreadMock = vi.fn();
const setThreadModelChoiceMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  setThreadPinned: (...args: unknown[]) => setThreadPinnedMock(...args),
  setThreadTitle: (...args: unknown[]) => setThreadTitleMock(...args),
  deleteThread: (...args: unknown[]) => deleteThreadMock(...args),
  setThreadModelChoice: (...args: unknown[]) => setThreadModelChoiceMock(...args),
}));

const dropWarmSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  dropWarmSession: (...args: unknown[]) => dropWarmSessionMock(...args),
}));

// Use the real allowlist helpers so validation is exercised end to end. The
// env default id is what the route accepts; AGENT_CHAT_MODELS enables switching.
process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
process.env.AGENT_CHAT_MODELS = "claude-opus-4-8,claude-sonnet-4-6";

const { PATCH, DELETE } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function patch(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/threads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  setThreadPinnedMock.mockReset().mockReturnValue(true);
  setThreadTitleMock.mockReset().mockReturnValue(true);
  deleteThreadMock.mockReset().mockReturnValue(true);
  setThreadModelChoiceMock.mockReset().mockReturnValue(true);
  dropWarmSessionMock.mockReset();
});

function del(id: string): Request {
  return new Request(`http://localhost/api/threads/${id}`, { method: "DELETE" });
}

describe("PATCH /api/threads/[id]", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await PATCH(patch("s1", { pinned: true }), ctx("s1"));
    expect(res.status).toBe(401);
    expect(setThreadPinnedMock).not.toHaveBeenCalled();
  });

  it("pins the caller's own thread, scoped to their email", async () => {
    const res = await PATCH(patch("s1", { pinned: true }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(setThreadPinnedMock).toHaveBeenCalledWith(expect.anything(), "s1", "alice@example.com", true);
    expect(await res.json()).toEqual({ id: "s1", pinned: true });
  });

  it("404s when the thread is unknown or owned by someone else (no row updated)", async () => {
    setThreadPinnedMock.mockReturnValue(false);
    const res = await PATCH(patch("s1", { pinned: true }), ctx("s1"));
    expect(res.status).toBe(404);
  });

  it("400s on a malformed body (pinned not a boolean)", async () => {
    const res = await PATCH(patch("s1", { pinned: "yes" }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(setThreadPinnedMock).not.toHaveBeenCalled();
  });

  it("stores an allow-listed model/effort override, owner-scoped, only present fields", async () => {
    const res = await PATCH(patch("s1", { effort: "low" }), ctx("s1"));
    expect(res.status).toBe(200);
    // Only the present field is passed through: model stays undefined (unchanged).
    expect(setThreadModelChoiceMock).toHaveBeenCalledWith(expect.anything(), "s1", "alice@example.com", {
      model: undefined,
      effort: "low",
    });
  });

  it("refreshes the warm session so the switch takes effect next turn", async () => {
    await PATCH(patch("s1", { model: "claude-sonnet-4-6" }), ctx("s1"));
    expect(dropWarmSessionMock).toHaveBeenCalledWith("s1");
  });

  it("does not evict a warm session when the model update matched no owned row", async () => {
    setThreadModelChoiceMock.mockReturnValue(false);
    const res = await PATCH(patch("s1", { effort: "low" }), ctx("s1"));
    expect(res.status).toBe(404);
    expect(dropWarmSessionMock).not.toHaveBeenCalled();
  });

  it("400s an off-allowlist model, never touching the store", async () => {
    const res = await PATCH(patch("s1", { model: "gpt-4o" }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(setThreadModelChoiceMock).not.toHaveBeenCalled();
  });

  it("400s a bogus effort level", async () => {
    const res = await PATCH(patch("s1", { effort: "turbo" }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(setThreadModelChoiceMock).not.toHaveBeenCalled();
  });

  it("renames the caller's own thread, trimming the title, owner-scoped", async () => {
    const res = await PATCH(patch("s1", { title: "  Q3 planning  " }), ctx("s1"));
    expect(res.status).toBe(200);
    expect(setThreadTitleMock).toHaveBeenCalledWith(expect.anything(), "s1", "alice@example.com", "Q3 planning");
  });

  it("400s an empty title, never touching the store", async () => {
    const res = await PATCH(patch("s1", { title: "   " }), ctx("s1"));
    expect(res.status).toBe(400);
    expect(setThreadTitleMock).not.toHaveBeenCalled();
  });

  it("404s a rename that matched no owned row", async () => {
    setThreadTitleMock.mockReturnValue(false);
    const res = await PATCH(patch("s1", { title: "new" }), ctx("s1"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/threads/[id]", () => {
  it("401s without an identity, before touching the store", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(401);
    expect(deleteThreadMock).not.toHaveBeenCalled();
  });

  it("deletes the caller's own thread and drops its warm session", async () => {
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(200);
    expect(deleteThreadMock).toHaveBeenCalledWith(expect.anything(), "s1", "alice@example.com");
    expect(dropWarmSessionMock).toHaveBeenCalledWith("s1");
  });

  it("404s (no oracle) when the thread is unknown or owned by someone else, and evicts nothing", async () => {
    deleteThreadMock.mockReturnValue(false);
    const res = await DELETE(del("s1"), ctx("s1"));
    expect(res.status).toBe(404);
    expect(dropWarmSessionMock).not.toHaveBeenCalled();
  });
});
