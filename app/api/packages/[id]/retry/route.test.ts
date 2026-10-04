import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const enqueuePackageMock = vi.fn();
vi.mock("@/lib/packages/queue", () => ({
  enqueuePackage: (...args: unknown[]) => enqueuePackageMock(...args),
}));

// Spy-only: the route no longer imports `discard` at all (Fix 3: the runner
// itself discards a stale worktree at the start of every run, see
// `lib/packages/runner.ts`), so this mock is never wired to anything the
// route calls. It stays here purely so a regression that reintroduces a
// `discard` import/call in this route is caught by the "never called"
// assertions below, rather than passing silently.
const discardMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  discard: (...args: unknown[]) => discardMock(...args),
}));

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertPackage, markProcessing, markFailed, getPackage } = await import("@/lib/db/packages");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

const ENV_KEYS = ["PACKAGES_ENABLED", "PACKAGES_DATA_DIR", "KB_WRITE_ENABLED"];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "packages-retry-route-test-"));
  process.env.PACKAGES_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.PACKAGES_DATA_DIR = tmpRoot;

  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  enqueuePackageMock.mockReset();
  discardMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function post(id: string): Request {
  return new Request(`http://localhost/api/packages/${id}/retry`, { method: "POST" });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/packages/[id]/retry", () => {
  it("404s when the flag is off, before touching auth", async () => {
    process.env.PACKAGES_ENABLED = "0";
    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(401);
  });

  it("403s on an unknown id, with no existence leak and no side effects", async () => {
    const res = await POST(post("does-not-exist"), ctx("does-not-exist"));
    expect(res.status).toBe(403);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("403s on a foreign package, before touching the retry guard", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: "bob@example.com", name: "Bob's package" });
    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(403);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("409s when the package is not in a retryable state (queued)", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(409);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
    expect(getPackage(db, "pkg-1")?.status).toBe("queued");
  });

  it("409s when the package is processing", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(409);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  // This route deliberately does NOT call `discard` itself anymore. A stale
  // worktree left behind by the run this retry supersedes is discarded by
  // `runPackageJob` itself at the start of the next run (see
  // `lib/packages/runner.ts` and its "boot-requeued crash recovery" seam
  // test in `lib/packages/runner.test.ts`), not by this route. That removes
  // the wedge this test used to guard against: `requeueForRetry` flipping
  // the row to `queued` before an awaited `discard()` that could throw,
  // leaving it queued-but-never-enqueued (and DELETE 409ing on `queued`,
  // wedged until restart).
  it("200s and requeues a failed package without calling discard", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    markFailed(db, "pkg-1", { error: "boom" });

    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(enqueuePackageMock).toHaveBeenCalledWith("pkg-1");
    expect(discardMock).not.toHaveBeenCalled();

    const record = getPackage(db, "pkg-1");
    expect(record?.status).toBe("queued");
    expect(record?.error).toBeNull();
  });

  it("200s and requeues a failed package that never had a thread", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    markFailed(db, "pkg-1", { error: "boom" });
    db.prepare("UPDATE packages SET thread_id = NULL WHERE id = ?").run("pkg-1");

    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    expect(enqueuePackageMock).toHaveBeenCalledWith("pkg-1");
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("500s with a structured error when enqueuePackage throws", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    markFailed(db, "pkg-1", { error: "boom" });
    enqueuePackageMock.mockImplementation(() => {
      throw new Error("queue blew up");
    });

    const res = await POST(post("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toEqual({ code: "internal" });
  });
});
