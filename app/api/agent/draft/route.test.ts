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

const changedFilesMock = vi.fn();
const worktreePathMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  changedFiles: (...args: unknown[]) => changedFilesMock(...args),
  worktreePath: (...args: unknown[]) => worktreePathMock(...args),
}));

const statSyncMock = vi.fn();
vi.mock("node:fs", () => ({
  statSync: (...args: unknown[]) => statSyncMock(...args),
}));

const { GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function get(sessionId?: string): Request {
  const url = sessionId
    ? `http://localhost/api/agent/draft?sessionId=${encodeURIComponent(sessionId)}`
    : "http://localhost/api/agent/draft";
  return new Request(url);
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  checkDraftAccessMock.mockReset();
  changedFilesMock.mockReset();
  worktreePathMock.mockReset().mockReturnValue("/data/worktrees/thread-1");
  statSyncMock.mockReset().mockReturnValue({ mtime: new Date("2026-07-05T00:00:00.000Z") });
});

describe("GET /api/agent/draft", () => {
  it("401s when there is no identity, before touching draft access", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await GET(get("thread-1"));
    expect(res.status).toBe(401);
    expect(checkDraftAccessMock).not.toHaveBeenCalled();
  });

  it("400s when sessionId is missing", async () => {
    const res = await GET(get());
    expect(res.status).toBe(400);
    expect(checkDraftAccessMock).not.toHaveBeenCalled();
  });

  it("403s on 'invalid-or-forbidden', without calling changedFiles", async () => {
    checkDraftAccessMock.mockReturnValue("invalid-or-forbidden");
    const res = await GET(get("thread-1"));
    expect(res.status).toBe(403);
    expect(changedFilesMock).not.toHaveBeenCalled();
  });

  it("200s with exists:false on 'own-but-gone', without calling changedFiles", async () => {
    checkDraftAccessMock.mockReturnValue("own-but-gone");
    const res = await GET(get("thread-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false, changedFiles: [], updatedAt: null });
    expect(changedFilesMock).not.toHaveBeenCalled();
  });

  it("200s with the real changed-file payload on 'own-and-live'", async () => {
    checkDraftAccessMock.mockReturnValue("own-and-live");
    changedFilesMock.mockResolvedValue([{ path: "docs/foo.md", status: "modified" }]);
    const res = await GET(get("thread-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(true);
    expect(body.changedFiles).toEqual([{ path: "docs/foo.md", status: "modified" }]);
    expect(body.updatedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(changedFilesMock).toHaveBeenCalledWith("thread-1");
  });

  it("500s cleanly if changedFiles throws", async () => {
    checkDraftAccessMock.mockReturnValue("own-and-live");
    changedFilesMock.mockRejectedValue(new Error("git blew up"));
    const res = await GET(get("thread-1"));
    expect(res.status).toBe(500);
  });
});
