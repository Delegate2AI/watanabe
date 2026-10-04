import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refreshRepoMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/repo", () => ({
  refreshRepo: (...args: unknown[]) => refreshRepoMock(...args),
}));

// A merge to main is also when a merge request may have merged, so this hook is
// where an artifact waiting on review finds out.
const order: string[] = [];
type Reconcile = (db: unknown) => Promise<{ promoted: number; rejected: number; pending: number }>;
const reconcileMock = vi.fn<Reconcile>(async () => {
  order.push("reconcile");
  return { promoted: 0, rejected: 0, pending: 0 };
});
vi.mock("@/lib/artifacts/reconcile", () => ({
  reconcileInReviewArtifacts: (db: unknown) => reconcileMock(db),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

// The link graph and backlink map are cached per clearance root on a TTL, so
// without this call a merged note stays out of "Referenced by" and off the
// graph for up to that interval, which is exactly what this hook exists to
// prevent.
const clearGraphMock = vi.fn(() => {
  order.push("clear-graph");
});
vi.mock("@/lib/kb/graph-cache", () => ({
  clearKbGraphCache: () => clearGraphMock(),
}));

const { POST } = await import("./route");

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/repo/refresh", { method: "POST", headers });
}

beforeEach(() => {
  order.length = 0;
  refreshRepoMock.mockClear().mockImplementation(async () => {
    order.push("refresh");
  });
  reconcileMock.mockClear();
  clearGraphMock.mockClear();
  delete process.env.REPO_REFRESH_WEBHOOK_SECRET;
});

afterEach(() => {
  delete process.env.REPO_REFRESH_WEBHOOK_SECRET;
});

describe("POST /api/repo/refresh", () => {
  it("501s and never refreshes when REPO_REFRESH_WEBHOOK_SECRET is unset — fails closed by absence", async () => {
    const res = await POST(post({ "x-gitlab-token": "whatever" }));
    expect(res.status).toBe(501);
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("401s and never refreshes when the token header is missing", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "shared-secret";
    const res = await POST(post());
    expect(res.status).toBe(401);
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("401s and never refreshes when the token header is wrong", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "shared-secret";
    const res = await POST(post({ "x-gitlab-token": "wrong" }));
    expect(res.status).toBe(401);
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("200s and refreshes the repo when the token matches", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "shared-secret";
    const res = await POST(post({ "x-gitlab-token": "shared-secret" }));
    expect(res.status).toBe(200);
    expect(refreshRepoMock).toHaveBeenCalledTimes(1);
  });

  it("reconciles artifacts waiting on review, AFTER refreshing the checkout", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "s3cret";
    const res = await POST(post({ "X-Gitlab-Token": "s3cret" }));

    expect(res.status).toBe(200);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    // Ordering is load-bearing: an artifact must only be called published once
    // the merged note is actually in the checkout the KB reads from.
    expect(order.indexOf("refresh")).toBeLessThan(order.indexOf("reconcile"));
  });

  it("drops the KB graph and backlink caches, AFTER refreshing the checkout", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "s3cret";
    const res = await POST(post({ "X-Gitlab-Token": "s3cret" }));

    expect(res.status).toBe(200);
    expect(clearGraphMock).toHaveBeenCalledTimes(1);
    // Order matters here too: clearing before the checkout moves would just
    // rebuild the same stale graph on the next read.
    expect(order).toEqual(["refresh", "clear-graph", "reconcile"]);
  });

  it("does not clear the KB graph cache when the hook is rejected", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "s3cret";
    const res = await POST(post({ "X-Gitlab-Token": "wrong" }));

    expect(res.status).toBe(401);
    expect(clearGraphMock).not.toHaveBeenCalled();
  });

  it("does not reconcile when the hook is rejected", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "s3cret";
    const res = await POST(post({ "X-Gitlab-Token": "wrong" }));

    expect(res.status).toBe(401);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  // The reconciler carries its own ARTIFACTS_ENABLED gate, so the webhook can
  // stay a plain "main moved" hook; this pins the delegation.
  it("delegates the artifacts gate to the reconciler rather than duplicating it", async () => {
    process.env.REPO_REFRESH_WEBHOOK_SECRET = "s3cret";
    await POST(post({ "X-Gitlab-Token": "s3cret" }));
    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });
});
