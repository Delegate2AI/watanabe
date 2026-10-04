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

const { DELETE, GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createDocument, listComments, upsertShare } = await import("@/lib/documents/store");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function bodyRequest(method: string, body: unknown): Request {
  return new Request("http://t/api/documents/d1/comments", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.UNIFIED_DOCS = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  createDocument(db, { id: "d1", ownerEmail: ALICE.email, title: "Plan", body: "b", originThreadId: null });
});

afterEach(() => {
  delete process.env.UNIFIED_DOCS;
});

describe("/api/documents/[id]/comments", () => {
  it("lets a comment recipient add, list, and remove a comment", async () => {
    upsertShare(db, "d1", BOB.email, "comment");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await POST(bodyRequest("POST", { body: "Looks good", anchor: "line 1" }), ctx("d1"))).status).toBe(201);
    const comment = listComments(db, "d1")[0];
    expect(comment).toMatchObject({ authorEmail: BOB.email, body: "Looks good", anchor: "line 1" });
    const listed = await GET(new Request("http://t/api/documents/d1/comments"), ctx("d1"));
    expect((await listed.json()) as object).toMatchObject({ comments: [{ id: comment.id }] });
    expect((await DELETE(bodyRequest("DELETE", { id: comment.id }), ctx("d1"))).status).toBe(200);
    expect(listComments(db, "d1")).toEqual([]);
  });

  it("denies view-only comment access", async () => {
    upsertShare(db, "d1", BOB.email, "view");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await GET(new Request("http://t/api/documents/d1/comments"), ctx("d1"))).status).toBe(403);
    expect((await POST(bodyRequest("POST", { body: "Nope" }), ctx("d1"))).status).toBe(403);
  });

  it("returns identical 404s for foreign and unknown documents", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const foreign = await GET(new Request("http://t/api/documents/d1/comments"), ctx("d1"));
    const unknown = await GET(new Request("http://t/api/documents/missing/comments"), ctx("missing"));
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("returns 404 for every method when disabled", async () => {
    delete process.env.UNIFIED_DOCS;
    expect((await GET(new Request("http://t/api/documents/d1/comments"), ctx("d1"))).status).toBe(404);
    expect((await POST(bodyRequest("POST", { body: "x" }), ctx("d1"))).status).toBe(404);
    expect((await DELETE(bodyRequest("DELETE", { id: "c1" }), ctx("d1"))).status).toBe(404);
  });
});
