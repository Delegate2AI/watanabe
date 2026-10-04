import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `lib/db/packages` runs for real against an in-memory DB (mocked only at
// `getDb`'s level) so ownership/status branching is exercised against real
// rows, not a scripted mock. Only the queue-adjacent side effects
// (`lib/repo-write`'s `discard`/`worktreeExists`) are mocked.

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const discardMock = vi.fn();
const worktreeExistsMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  discard: (...args: unknown[]) => discardMock(...args),
  worktreeExists: (...args: unknown[]) => worktreeExistsMock(...args),
}));

const { GET, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertPackage, markProcessing, markFailed } = await import("@/lib/db/packages");
const { packageDir } = await import("@/lib/packages/config");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

const ENV_KEYS = ["PACKAGES_ENABLED", "PACKAGES_DATA_DIR", "KB_WRITE_ENABLED"];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "packages-id-route-test-"));
  process.env.PACKAGES_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.PACKAGES_DATA_DIR = tmpRoot;

  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  discardMock.mockReset().mockResolvedValue(undefined);
  worktreeExistsMock.mockReset().mockReturnValue(false);
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function req(id: string, method: "GET" | "DELETE" = "GET"): Request {
  return new Request(`http://localhost/api/packages/${id}`, { method });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/packages/[id]", () => {
  it("404s when the flag is off, before touching auth", async () => {
    process.env.PACKAGES_ENABLED = "0";
    const res = await GET(req("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await GET(req("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(401);
  });

  it("403s on an unknown id, with no existence leak", async () => {
    const res = await GET(req("does-not-exist"), ctx("does-not-exist"));
    expect(res.status).toBe(403);
  });

  it("403s on a foreign package", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: "bob@example.com", name: "Bob's package" });
    const res = await GET(req("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(403);
  });

  it("200s with the full record and draftLive:false when there is no thread", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    const res = await GET(req("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("pkg-1");
    expect(body.name).toBe("Mine");
    expect(body.draftLive).toBe(false);
    expect(worktreeExistsMock).not.toHaveBeenCalled();
  });

  it("200s with draftLive reflecting worktreeExists when a thread is attached", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    worktreeExistsMock.mockReturnValue(true);
    const res = await GET(req("pkg-1"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.draftLive).toBe(true);
    expect(worktreeExistsMock).toHaveBeenCalledWith("thread-1");
  });
});

describe("DELETE /api/packages/[id]", () => {
  it("404s when the flag is off, before touching auth", async () => {
    process.env.PACKAGES_ENABLED = "0";
    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(401);
  });

  it("403s on an unknown id, with no existence leak and no side effects", async () => {
    const res = await DELETE(req("does-not-exist", "DELETE"), ctx("does-not-exist"));
    expect(res.status).toBe(403);
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("403s on a foreign package", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: "bob@example.com", name: "Bob's package" });
    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(403);
  });

  it("409s while the package is queued, leaving its row and directory intact", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    const dir = path.dirname(packageDir("pkg-1"));
    fs.mkdirSync(dir, { recursive: true });

    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(409);
    expect(discardMock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT id FROM packages WHERE id = ?").get("pkg-1")).toEqual({ id: "pkg-1" });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("409s while the package is processing, leaving its row and directory intact", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    const dir = path.dirname(packageDir("pkg-1"));
    fs.mkdirSync(dir, { recursive: true });

    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(409);
    expect(discardMock).not.toHaveBeenCalled();
    expect(db.prepare("SELECT id FROM packages WHERE id = ?").get("pkg-1")).toEqual({ id: "pkg-1" });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("500s with a structured error when discard throws, keeping the row", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    markFailed(db, "pkg-1", { error: "boom" });
    discardMock.mockRejectedValue(new Error("git blew up"));

    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toEqual({ code: "internal" });
    expect(db.prepare("SELECT id FROM packages WHERE id = ?").get("pkg-1")).toEqual({ id: "pkg-1" });
  });

  it("200s and removes the package's row, on-disk directory, and worktree when failed", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markProcessing(db, "pkg-1", "thread-1");
    markFailed(db, "pkg-1", { error: "boom" });

    const dir = path.dirname(packageDir("pkg-1"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), "{}");

    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(discardMock).toHaveBeenCalledWith("thread-1");
    expect(fs.existsSync(dir)).toBe(false);

    const row = db.prepare("SELECT * FROM packages WHERE id = ?").get("pkg-1");
    expect(row).toBeUndefined();
  });

  it("200s and skips discard when the package never had a thread", async () => {
    insertPackage(db, { id: "pkg-1", ownerEmail: IDENTITY.email, name: "Mine" });
    markFailed(db, "pkg-1", { error: "boom" });

    const res = await DELETE(req("pkg-1", "DELETE"), ctx("pkg-1"));
    expect(res.status).toBe(200);
    expect(discardMock).not.toHaveBeenCalled();
  });
});
