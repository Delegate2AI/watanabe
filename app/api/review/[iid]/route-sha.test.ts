import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Proposal } from "@/lib/review/queue";

vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: async () => ({ identity: { email: "alice@example.com", name: "Alice Doe" } }),
}));
vi.mock("@/lib/authority/roles", () => ({ can: () => true }));
vi.mock("@/lib/review/config", () => ({ isKbReviewEnabled: () => true }));

const loadProposalMock = vi.fn();
vi.mock("@/lib/review/queue", () => ({
  loadProposal: (...args: unknown[]) => loadProposalMock(...args),
}));

const mergeMock = vi.fn();
const closeMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    mergeChangeRequest: (...args: unknown[]) => mergeMock(...args),
    closeChangeRequest: (...args: unknown[]) => closeMock(...args),
  }),
}));
const refreshRepoMock = vi.fn();
vi.mock("@/lib/repo", () => ({ refreshRepo: () => refreshRepoMock() }));
vi.mock("@/lib/index/config", () => ({ isIndexEnabled: () => false }));
vi.mock("@/lib/index/cache", () => ({ rebuildIndex: () => ({}) }));
vi.mock("@/lib/kb/graph-cache", () => ({ clearKbGraphCache: () => {} }));
vi.mock("@/lib/artifacts/reconcile", () => ({ reconcileInReviewArtifacts: async () => ({}) }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { listDecisions } = await import("@/lib/db/review-decisions");

const HEAD = "1111111111111111111111111111111111111111";
const MOVED = "2222222222222222222222222222222222222222";

function proposal(): Proposal {
  return {
    iid: 7,
    title: "Add note",
    proposer: "bob@example.com",
    createdAt: "2026-08-18T10:00:00Z",
    webUrl: "https://gl/mr/7",
    sourceBranch: "kb/bob/add-7",
    sha: HEAD,
    paths: ["docs/a.md"],
    changes: [],
    origin: "artifact",
  };
}

function post(body: unknown): [Request, { params: Promise<{ iid: string }> }] {
  return [
    new Request("http://t/api/review/7", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ iid: "7" }) },
  ];
}

beforeEach(() => {
  process.env.REPO_WRITE_TOKEN = "tok";
  db = openDb(":memory:");
  loadProposalMock.mockReset().mockResolvedValue(proposal());
  mergeMock.mockReset().mockResolvedValue({ ok: true });
  closeMock.mockReset().mockResolvedValue(undefined);
  refreshRepoMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.REPO_WRITE_TOKEN;
});

describe("POST /api/review/[iid] pins the reviewed head", () => {
  it("merges with the sha the reviewer saw when it is still the head", async () => {
    const res = await POST(...post({ action: "approve", sha: HEAD }));
    expect(res.status).toBe(200);
    expect(mergeMock).toHaveBeenCalledWith({ iid: 7, token: "tok", sha: HEAD });
  });

  it("refuses with 409 stale_head when the branch moved after the reviewer loaded it", async () => {
    loadProposalMock.mockResolvedValue({ ...proposal(), sha: MOVED });
    const res = await POST(...post({ action: "approve", sha: HEAD }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", detail: "stale_head" } });
    expect(mergeMock).not.toHaveBeenCalled();
    expect(listDecisions(db, 7)).toEqual([]);
  });

  it("refuses an approve that names no sha with 400, before touching the repo", async () => {
    const res = await POST(...post({ action: "approve" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "sha" } });
    expect(refreshRepoMock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("still rejects without a sha, since closing merges nothing", async () => {
    const res = await POST(...post({ action: "reject" }));
    expect(res.status).toBe(200);
    expect(closeMock).toHaveBeenCalledWith({ iid: 7, token: "tok" });
  });
});
