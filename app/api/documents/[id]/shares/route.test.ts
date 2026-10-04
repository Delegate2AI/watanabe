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
const { createDocument, listShares, upsertShare } = await import("@/lib/documents/store");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function bodyRequest(method: string, body: unknown): Request {
  return new Request("http://t/api/documents/d1/shares", {
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

describe("/api/documents/[id]/shares", () => {
  it("lets the owner add, list, update, and remove shares", async () => {
    expect((await POST(bodyRequest("POST", { recipientEmail: BOB.email, access: "view" }), ctx("d1"))).status).toBe(201);
    expect((await POST(bodyRequest("POST", { recipientEmail: BOB.email, access: "comment" }), ctx("d1"))).status).toBe(201);
    const listed = await GET(new Request("http://t/api/documents/d1/shares"), ctx("d1"));
    expect((await listed.json()) as object).toMatchObject({ shares: [{ recipientEmail: BOB.email, access: "comment" }] });
    expect((await DELETE(bodyRequest("DELETE", { recipientEmail: BOB.email }), ctx("d1"))).status).toBe(200);
    expect(listShares(db, "d1")).toEqual([]);
  });

  it("does not let a shared recipient manage shares", async () => {
    upsertShare(db, "d1", BOB.email, "edit");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await GET(new Request("http://t/api/documents/d1/shares"), ctx("d1"))).status).toBe(403);
    expect((await POST(bodyRequest("POST", { recipientEmail: "x@example.com", access: "view" }), ctx("d1"))).status).toBe(403);
    expect((await DELETE(bodyRequest("DELETE", { recipientEmail: ALICE.email }), ctx("d1"))).status).toBe(403);
  });

  it("returns identical 404s for foreign and unknown documents", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const foreign = await GET(new Request("http://t/api/documents/d1/shares"), ctx("d1"));
    const unknown = await GET(new Request("http://t/api/documents/missing/shares"), ctx("missing"));
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("returns 404 for every method when disabled", async () => {
    delete process.env.UNIFIED_DOCS;
    expect((await GET(new Request("http://t/api/documents/d1/shares"), ctx("d1"))).status).toBe(404);
    expect((await POST(bodyRequest("POST", { recipientEmail: BOB.email, access: "view" }), ctx("d1"))).status).toBe(404);
    expect((await DELETE(bodyRequest("DELETE", { recipientEmail: BOB.email }), ctx("d1"))).status).toBe(404);
  });
});
