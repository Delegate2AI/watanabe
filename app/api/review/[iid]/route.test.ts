import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Proposal } from "@/lib/review/queue";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isKbReviewEnabledMock = vi.fn();
vi.mock("@/lib/review/config", () => ({
  isKbReviewEnabled: () => isKbReviewEnabledMock(),
}));

const loadProposalMock = vi.fn();
vi.mock("@/lib/review/queue", () => ({
  loadProposal: (...args: unknown[]) => loadProposalMock(...args),
}));

// The post-merge sequence is the contract under test, so every step records the
// order it ran in rather than doing its real work.
const order: string[] = [];
const mergeMergeRequestMock = vi.fn();
const closeMergeRequestMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    mergeChangeRequest: async (...args: unknown[]) => {
      order.push("merge");
      return mergeMergeRequestMock(...args);
    },
    closeChangeRequest: async (...args: unknown[]) => {
      order.push("close");
      return closeMergeRequestMock(...args);
    },
  }),
}));
vi.mock("@/lib/repo", () => ({
  refreshRepo: async () => {
    order.push("refreshRepo");
  },
}));
const isIndexEnabledMock = vi.fn();
vi.mock("@/lib/index/config", () => ({
  isIndexEnabled: () => isIndexEnabledMock(),
}));
vi.mock("@/lib/index/cache", () => ({
  rebuildIndex: () => {
    order.push("rebuildIndex");
    return {};
  },
}));
vi.mock("@/lib/kb/graph-cache", () => ({
  clearKbGraphCache: () => {
    order.push("clearKbGraphCache");
  },
}));
const reconcileMock = vi.fn();
vi.mock("@/lib/artifacts/reconcile", () => ({
  reconcileInReviewArtifacts: async (...args: unknown[]) => {
    order.push("reconcile");
    return reconcileMock(...args);
  },
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { listDecisions } = await import("@/lib/db/review-decisions");

const ALICE = { email: "alice@example.com", name: "Alice Doe" };

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    iid: 7,
    title: "Add note",
    proposer: "bob@example.com",
    createdAt: "2026-08-18T10:00:00Z",
    webUrl: "https://gl/mr/7",
    sourceBranch: "kb/alice/add-7",
    sha: "abc123",
    paths: ["docs/a.md"],
    changes: [],
    origin: "artifact",
    ...over,
  };
}

function post(body: unknown, iid = "7"): [Request, { params: Promise<{ iid: string }> }] {
  return [
    new Request(`http://t/api/review/${iid}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ iid }) },
  ];
}

beforeEach(() => {
  process.env.REPO_WRITE_TOKEN = "tok";
  db = openDb(":memory:");
  order.length = 0;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(true);
  isKbReviewEnabledMock.mockReset().mockReturnValue(true);
  loadProposalMock.mockReset().mockResolvedValue(proposal());
  mergeMergeRequestMock.mockReset().mockResolvedValue({ ok: true });
  closeMergeRequestMock.mockReset().mockResolvedValue(undefined);
  isIndexEnabledMock.mockReset().mockReturnValue(true);
  reconcileMock.mockReset().mockResolvedValue({ promoted: 0, rejected: 0, pending: 0 });
});

afterEach(() => {
  delete process.env.REPO_WRITE_TOKEN;
});

describe("POST /api/review/[iid] gates", () => {
  it("404s when the flag is off", async () => {
    isKbReviewEnabledMock.mockReturnValue(false);
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(404);
    expect(order).toEqual([]);
  });

  it("hands back the identity refusal when there is no identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "x" }, { status: 401 }) });
    expect((await POST(...post({ action: "approve", sha: "abc123" }))).status).toBe(401);
    expect(order).toEqual([]);
  });

  it("403s needs_role for someone without approve", async () => {
    canMock.mockReturnValue(false);
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "needs_role" } });
    expect(canMock).toHaveBeenCalledWith(ALICE.email, "approve");
    expect(order).toEqual([]);
  });

  it("400s an iid that is not a positive integer", async () => {
    const res = await POST(...post({ action: "approve", sha: "abc123" }, "abc"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "iid" } });
  });

  it("rejects an unknown action with invalid_request", async () => {
    const res = await POST(...post({ action: "merge-please" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "action" } });
    expect(order).toEqual([]);
  });

  it("rejects a body that is not JSON with invalid_request", async () => {
    const request = new Request("http://t/api/review/7", { method: "POST", body: "not json" });
    const res = await POST(request, { params: Promise.resolve({ iid: "7" }) });
    expect(res.status).toBe(400);
    expect(order).toEqual([]);
  });

  it("503s write_unavailable with no write token configured", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "write_unavailable" } });
    expect(order).toEqual([]);
  });

  it("403s not_cleared for an iid outside the requester's clearance", async () => {
    loadProposalMock.mockResolvedValue(null);
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "not_cleared" } });
    // The pre-authorization refresh is all that ran: nothing was merged or closed.
    expect(order).toEqual(["refreshRepo"]);
  });

  it("answers an unknown iid with the identical refusal, so the queue is not an existence oracle", async () => {
    loadProposalMock.mockResolvedValue(null);
    const cleared = await POST(...post({ action: "approve", sha: "abc123" }, "7"));
    const unknown = await POST(...post({ action: "approve", sha: "abc123" }, "999"));
    expect(unknown.status).toBe(cleared.status);
    expect(await unknown.json()).toEqual(await cleared.json());
  });

  it("502s review_unavailable when the queue cannot be read", async () => {
    loadProposalMock.mockRejectedValue(new Error("unreachable"));
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "review_unavailable" } });
    expect(order).toEqual(["refreshRepo"]);
  });
});

describe("POST /api/review/[iid] approve", () => {
  it("merges, then refreshes the repo, index and graph cache in that order", async () => {
    const res = await POST(...post({ action: "approve", sha: "abc123" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(order).toEqual(["refreshRepo", "merge", "refreshRepo", "rebuildIndex", "clearKbGraphCache", "reconcile"]);
    expect(mergeMergeRequestMock).toHaveBeenCalledWith({ iid: 7, token: "tok", sha: "abc123" });
    expect(reconcileMock).toHaveBeenCalledWith(db);
  });

  it("skips the index rebuild when the index is off", async () => {
    isIndexEnabledMock.mockReturnValue(false);
    await POST(...post({ action: "approve", sha: "abc123" }));
    expect(order).toEqual(["refreshRepo", "merge", "refreshRepo", "clearKbGraphCache", "reconcile"]);
  });

  it("409s conflict when the merge is refused, logs GitLab's reason, and records no decision", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    mergeMergeRequestMock.mockResolvedValue({ ok: false, status: 405, reason: "Branch cannot be merged" });

    const res = await POST(...post({ action: "approve", sha: "abc123" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", detail: "merge_refused" } });
    expect(order).toEqual(["refreshRepo", "merge"]);
    expect(listDecisions(db, 7)).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).toContain("Branch cannot be merged");
    warn.mockRestore();
  });

  it("records the decision against the changed paths", async () => {
    await POST(...post({ action: "approve", sha: "abc123" }));
    expect(listDecisions(db, 7)).toEqual([
      expect.objectContaining({
        iid: 7,
        actorEmail: ALICE.email,
        action: "approve",
        paths: ["docs/a.md"],
        selfApproval: false,
      }),
    ]);
  });

  it("flags a self-approval when the actor is the proposer, alias-aware on the email", async () => {
    loadProposalMock.mockResolvedValue(proposal({ proposer: "Alice@Example.com" }));
    await POST(...post({ action: "approve", sha: "abc123" }));
    expect(listDecisions(db, 7)[0]).toMatchObject({ selfApproval: true });
  });

  it("flags a self-approval when a chat proposal names the actor, case-insensitively", async () => {
    loadProposalMock.mockResolvedValue(proposal({ proposer: "alice doe", origin: "chat" }));
    await POST(...post({ action: "approve", sha: "abc123" }));
    expect(listDecisions(db, 7)[0]).toMatchObject({ selfApproval: true });
  });

  it("does not flag a self-approval when a chat proposal names someone else", async () => {
    loadProposalMock.mockResolvedValue(proposal({ proposer: "Portal Bot", origin: "chat" }));
    await POST(...post({ action: "approve", sha: "abc123" }));
    expect(listDecisions(db, 7)[0]).toMatchObject({ selfApproval: false });
  });
});

describe("POST /api/review/[iid] reject", () => {
  it("closes the merge request and records it, without touching the vault", async () => {
    const res = await POST(...post({ action: "reject" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(order).toEqual(["refreshRepo", "close"]);
    expect(closeMergeRequestMock).toHaveBeenCalledWith({ iid: 7, token: "tok" });
    expect(listDecisions(db, 7)).toEqual([
      expect.objectContaining({
        iid: 7,
        actorEmail: ALICE.email,
        action: "reject",
        paths: ["docs/a.md"],
        selfApproval: false,
      }),
    ]);
  });

  it("502s review_unavailable when GitLab refuses the close, and records no decision", async () => {
    closeMergeRequestMock.mockRejectedValue(new Error("500"));
    const res = await POST(...post({ action: "reject" }));
    expect(res.status).toBe(502);
    expect(listDecisions(db, 7)).toEqual([]);
  });
});
