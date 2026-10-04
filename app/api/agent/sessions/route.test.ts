import { describe, it, expect, vi, beforeEach } from "vitest";

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

const listThreadsForOwnerMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  listThreadsForOwner: (...args: unknown[]) => listThreadsForOwnerMock(...args),
}));

const loadTranscriptMock = vi.fn();
vi.mock("@/lib/agent/transcript", () => ({
  loadTranscript: (...args: unknown[]) => loadTranscriptMock(...args),
}));

const getSessionMock = vi.fn();
const sessionExistsOnDiskMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  sessionExistsOnDisk: (...args: unknown[]) => sessionExistsOnDiskMock(...args),
}));

const { GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const TURN = { id: "t1", role: "user", content: "hi" };

function get(id?: string): Request {
  const url = id
    ? `http://localhost/api/agent/sessions?id=${encodeURIComponent(id)}`
    : "http://localhost/api/agent/sessions";
  return new Request(url);
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  listThreadsForOwnerMock.mockReset().mockReturnValue([]);
  loadTranscriptMock.mockReset().mockResolvedValue([TURN]);
  getSessionMock.mockReset().mockReturnValue(undefined);
  sessionExistsOnDiskMock.mockReset().mockResolvedValue(true);
});

describe("GET /api/agent/sessions?id=", () => {
  it("401s when there is no identity, before any ownership check", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await GET(get("session-1"));
    expect(res.status).toBe(401);
    expect(isOwnedByMock).not.toHaveBeenCalled();
  });

  it("403s on an unknown or foreign id, without touching the transcript store", async () => {
    isOwnedByMock.mockReturnValue(false);
    const res = await GET(get("session-1"));
    expect(res.status).toBe(403);
    expect(loadTranscriptMock).not.toHaveBeenCalled();
    // Ownership runs BEFORE the gone check — a 404 must never leak existence
    // of a session the caller doesn't own (spec 15 D32 safety invariant).
    expect(sessionExistsOnDiskMock).not.toHaveBeenCalled();
  });

  it("404s for an owned id that is empty, cold in memory, and absent on disk", async () => {
    loadTranscriptMock.mockResolvedValue([]);
    getSessionMock.mockReturnValue(undefined);
    sessionExistsOnDiskMock.mockResolvedValue(false);
    const res = await GET(get("session-1"));
    expect(res.status).toBe(404);
  });

  it("200s with empty turns and active:true for an owned in-flight session (warm + busy)", async () => {
    // The exact race the old client mishandled: first turn still running,
    // nothing flushed to disk yet — but the session is warm. Must NOT 404,
    // and `active` tells the client to keep polling (spec 15 D34).
    loadTranscriptMock.mockResolvedValue([]);
    getSessionMock.mockReturnValue({ isEnded: false, isBusy: true });
    sessionExistsOnDiskMock.mockResolvedValue(false);
    const res = await GET(get("session-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turns: [], active: true });
  });

  it("200s with empty turns and active:false when the transcript is empty but exists on disk", async () => {
    loadTranscriptMock.mockResolvedValue([]);
    getSessionMock.mockReturnValue(undefined);
    sessionExistsOnDiskMock.mockResolvedValue(true);
    const res = await GET(get("session-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turns: [], active: false });
  });

  it("200s with the transcript, active:false for a warm-but-idle session", async () => {
    getSessionMock.mockReturnValue({ isEnded: false, isBusy: false });
    const res = await GET(get("session-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ turns: [TURN], active: false });
    // Non-empty transcript short-circuits the gone check entirely.
    expect(sessionExistsOnDiskMock).not.toHaveBeenCalled();
  });

  it("500s cleanly if loadTranscript throws", async () => {
    loadTranscriptMock.mockRejectedValue(new Error("disk blew up"));
    const res = await GET(get("session-1"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/agent/sessions (list)", () => {
  it("returns the caller's threads, newest-first shape preserved", async () => {
    listThreadsForOwnerMock.mockReturnValue([
      { sdkSessionId: "s1", title: "First chat", updatedAt: "2026-07-08T00:00:00.000Z" },
      { sdkSessionId: "s2", title: null, updatedAt: "2026-07-07T00:00:00.000Z" },
    ]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [
        { id: "s1", title: "First chat", updatedAt: "2026-07-08T00:00:00.000Z" },
        { id: "s2", title: "New chat", updatedAt: "2026-07-07T00:00:00.000Z" },
      ],
    });
  });
});
