import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

// Only the queue is mocked (spies on `enqueuePackage`); everything else
// (`normalizePackage`/`writeMeta`, `lib/db/packages`, `lib/packages/config`)
// runs for real, against a scratch `PACKAGES_DATA_DIR` and an in-memory DB, so
// these tests exercise the actual upload -> normalize -> insert -> enqueue
// pipeline, not just the route's own branching.

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

const { POST, GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertPackage } = await import("@/lib/db/packages");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

const ENV_KEYS = [
  "PACKAGES_ENABLED",
  "PACKAGES_DATA_DIR",
  "PACKAGES_MAX_TOTAL_BYTES",
  "PACKAGES_MAX_FILE_BYTES",
  "PACKAGES_MAX_ENTRY_COUNT",
  "KB_WRITE_ENABLED",
];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "packages-route-test-"));
  process.env.PACKAGES_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.PACKAGES_DATA_DIR = tmpRoot;

  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  enqueuePackageMock.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function zipBuffer(build: (zip: AdmZip) => void): Buffer {
  const zip = new AdmZip();
  build(zip);
  return zip.toBuffer();
}

function smallZipFile(name = "bundle.zip"): File {
  const data = zipBuffer((zip) => {
    zip.addFile("README.md", Buffer.from("# hello\n"));
  });
  return new File([Uint8Array.from(data)], name, { type: "application/zip" });
}

/**
 * Builds a POST request from `formData`, with a real `Content-Length` header
 * computed from the actual encoded multipart body (a plain `new Request(...,
 * { body: formData })` never sets one, see route.ts's Content-Length guard,
 * Fix 1). `headerOverrides` is applied after that default: a `null` value
 * deletes the header (to simulate a client omitting it entirely), a string
 * value replaces it (to simulate a lying/garbage header).
 */
async function postUpload(formData: FormData, headerOverrides?: Record<string, string | null>): Promise<Request> {
  const encoded = new Response(formData);
  const body = await encoded.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", encoded.headers.get("content-type") ?? "");
  headers.set("content-length", String(body.byteLength));
  for (const [key, value] of Object.entries(headerOverrides ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request("http://localhost/api/packages", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/packages", () => {
  it("404s when the flag is off, before touching auth", async () => {
    process.env.PACKAGES_ENABLED = "0";
    const fd = new FormData();
    fd.append("file", smallZipFile());
    const res = await POST(await postUpload(fd));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const fd = new FormData();
    fd.append("file", smallZipFile());
    const res = await POST(await postUpload(fd));
    expect(res.status).toBe(401);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("411s when the Content-Length header is missing, without ever reading the body", async () => {
    const fd = new FormData();
    fd.append("file", smallZipFile());
    const res = await POST(await postUpload(fd, { "content-length": null }));
    expect(res.status).toBe(411);
    const body = (await res.json()) as { error: string };
    expect(body.error).toEqual({ code: "invalid_request", detail: "content-length" });
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("411s when the Content-Length header is garbage (not a positive integer)", async () => {
    const fd = new FormData();
    fd.append("file", smallZipFile());
    for (const garbage of ["not-a-number", "0", "-5", "1.5"]) {
      const res = await POST(await postUpload(fd, { "content-length": garbage }));
      expect(res.status).toBe(411);
    }
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("413s on an oversized Content-Length header, without ever reading the body", async () => {
    const fd = new FormData();
    fd.append("file", smallZipFile());
    const res = await POST(await postUpload(fd, { "content-length": "999999999999" }));
    expect(res.status).toBe(413);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("413s on the actual uploaded bytes even when a lying client's Content-Length header understates them", async () => {
    process.env.PACKAGES_MAX_TOTAL_BYTES = "10";
    const fd = new FormData();
    fd.append("file", smallZipFile());
    // A declared length that passes the cheap header check (5 <= 10) but is
    // far smaller than the real encoded body: the second check, against the
    // actual parsed file bytes, must still catch it.
    const res = await POST(await postUpload(fd, { "content-length": "5" }));
    expect(res.status).toBe(413);
    expect(enqueuePackageMock).not.toHaveBeenCalled();
  });

  it("400s and reports normalizePackage's own error when the upload is rejected", async () => {
    const emptyZip = zipBuffer(() => {});
    const fd = new FormData();
    fd.append("file", new File([Uint8Array.from(emptyZip)], "empty.zip", { type: "application/zip" }));
    const res = await POST(await postUpload(fd));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toEqual({ code: "invalid_request", detail: "package" });
    expect(enqueuePackageMock).not.toHaveBeenCalled();
    // A rejected upload must leave nothing behind: no DB row and no on-disk
    // directory for the id it minted.
    expect(db.prepare("SELECT COUNT(*) AS n FROM packages").get()).toEqual({ n: 0 });
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  it("500s and removes the landed package directory when a post-normalize step throws", async () => {
    enqueuePackageMock.mockImplementation(() => {
      throw new Error("queue exploded");
    });
    const fd = new FormData();
    fd.append("file", smallZipFile());
    const res = await POST(await postUpload(fd));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // The thrown message stays in the log; the body carries a code only.
    expect(body.error).toEqual({ code: "internal" });
    // Normalization had already landed files for the minted id (and the row
    // was inserted before the queue call threw); the failure path must remove
    // both so no orphan leaks.
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM packages").get()).toEqual({ n: 0 });
  });

  it("201s on a happy upload: writes the package, inserts a queued row, and enqueues it", async () => {
    const fd = new FormData();
    fd.append("file", smallZipFile("bundle.zip"));
    const res = await POST(await postUpload(fd));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; status: string };
    expect(body.status).toBe("queued");
    expect(body.name).toBe("bundle");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(enqueuePackageMock).toHaveBeenCalledWith(body.id);

    const row = db.prepare("SELECT * FROM packages WHERE id = ?").get(body.id) as { owner_email: string; status: string };
    expect(row.owner_email).toBe(IDENTITY.email);
    expect(row.status).toBe("queued");

    expect(fs.existsSync(path.join(tmpRoot, body.id, "meta.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, body.id, "package", "README.md"))).toBe(true);
  });
});

describe("GET /api/packages", () => {
  function get(): Request {
    return new Request("http://localhost/api/packages");
  }

  it("404s when the flag is off, before touching auth", async () => {
    process.env.PACKAGES_ENABLED = "0";
    const res = await GET(get());
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s when there is no identity", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await GET(get());
    expect(res.status).toBe(401);
  });

  it("returns only the caller's own packages, with report omitted", async () => {
    insertPackage(db, { id: "pkg-mine", ownerEmail: IDENTITY.email, name: "Mine" });
    insertPackage(db, { id: "pkg-theirs", ownerEmail: "bob@example.com", name: "Theirs" });
    db.prepare("UPDATE packages SET report = ? WHERE id = ?").run("a long report", "pkg-mine");

    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { packages: Array<Record<string, unknown>> };
    expect(body.packages).toHaveLength(1);
    expect(body.packages[0].id).toBe("pkg-mine");
    expect(body.packages[0]).not.toHaveProperty("report");
  });
});
