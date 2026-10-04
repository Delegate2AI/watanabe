import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { DELETE, GET, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const {
  addComment,
  addLink,
  addPublication,
  createDocument,
  getDocument,
  listVersions,
  upsertShare,
} = await import("@/lib/documents/store");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string) => new Request(`http://t/api/documents/${id}`);
function patch(id: string, body: unknown): Request {
  return new Request(`http://t/api/documents/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.UNIFIED_DOCS = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  createDocument(db, { id: "d1", ownerEmail: ALICE.email, title: "Plan", body: "# v1", originThreadId: null });
});

afterEach(() => {
  delete process.env.UNIFIED_DOCS;
});

describe("GET /api/documents/[id]", () => {
  it("returns the complete document and derived disposition", async () => {
    upsertShare(db, "d1", BOB.email, "comment");
    addComment(db, { id: "c1", docId: "d1", authorEmail: BOB.email, body: "Looks good", anchor: null });
    addLink(db, { token: "tok", docId: "d1", access: "view", expiresAt: null });
    addPublication(db, { docId: "d1", status: "ready", targetPath: "docs/plan.md", targetVisibility: ["team"], publishedNotePath: null });
    const res = await GET(request("d1"), ctx("d1"));
    const data = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ access: "owner", body: "# v1", disposition: { private: false, shared: true, published: true } });
    expect(data).toHaveProperty("document");
    expect(data).toHaveProperty("versions");
    expect(data).toHaveProperty("shares");
    expect(data).toHaveProperty("comments");
    expect(data).toHaveProperty("links");
    expect(data).toHaveProperty("publication");
  });

  it("allows a shared recipient to read", async () => {
    upsertShare(db, "d1", BOB.email, "view");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(request("d1"), ctx("d1"));
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ access: "view", body: "# v1" });
  });

  it("returns identical 404 responses for foreign and unknown ids", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const foreign = await GET(request("d1"), ctx("d1"));
    const unknown = await GET(request("missing"), ctx("missing"));
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("returns 404 when disabled", async () => {
    delete process.env.UNIFIED_DOCS;
    expect((await GET(request("d1"), ctx("d1"))).status).toBe(404);
  });
});

describe("PATCH /api/documents/[id]", () => {
  it("renames and appends a version for the owner", async () => {
    const res = await PATCH(patch("d1", { title: "Renamed", body: "# v2" }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(getDocument(db, "d1")?.title).toBe("Renamed");
    expect(listVersions(db, "d1").map((version) => version.body)).toEqual(["# v1", "# v2"]);
  });

  it("allows edit access to append a version but denies comment access", async () => {
    upsertShare(db, "d1", BOB.email, "edit");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await PATCH(patch("d1", { body: "# bob" }), ctx("d1"))).status).toBe(200);
    upsertShare(db, "d1", BOB.email, "comment");
    expect((await PATCH(patch("d1", { body: "# denied" }), ctx("d1"))).status).toBe(403);
  });

  it("returns 404 for foreign, unknown, and flag-off requests", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    expect((await PATCH(patch("d1", { title: "X" }), ctx("d1"))).status).toBe(404);
    expect((await PATCH(patch("missing", { title: "X" }), ctx("missing"))).status).toBe(404);
    delete process.env.UNIFIED_DOCS;
    expect((await PATCH(patch("d1", { title: "X" }), ctx("d1"))).status).toBe(404);
  });
});

describe("DELETE /api/documents/[id]", () => {
  it("deletes for the owner only", async () => {
    expect((await DELETE(request("d1"), ctx("d1"))).status).toBe(200);
    expect(getDocument(db, "d1")).toBeNull();
  });

  it("denies a shared recipient and hides foreign or unknown ids", async () => {
    upsertShare(db, "d1", BOB.email, "edit");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await DELETE(request("d1"), ctx("d1"))).status).toBe(403);
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const foreign = await DELETE(request("d1"), ctx("d1"));
    const unknown = await DELETE(request("missing"), ctx("missing"));
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("returns 404 when disabled", async () => {
    delete process.env.UNIFIED_DOCS;
    expect((await DELETE(request("d1"), ctx("d1"))).status).toBe(404);
  });
});
