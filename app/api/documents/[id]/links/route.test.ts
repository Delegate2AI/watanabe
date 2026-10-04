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
const { createDocument, listLinks, upsertShare } = await import("@/lib/documents/store");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function bodyRequest(method: string, body: unknown): Request {
  return new Request("http://t/api/documents/d1/links", {
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

describe("/api/documents/[id]/links", () => {
  it("lets the owner create, list, and revoke a link", async () => {
    const created = await POST(bodyRequest("POST", { access: "comment", expiresInHours: 2 }), ctx("d1"));
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect(listLinks(db, "d1")).toHaveLength(1);
    const listed = await GET(new Request("http://t/api/documents/d1/links"), ctx("d1"));
    expect((await listed.json()) as object).toMatchObject({ links: [{ token, access: "comment" }] });
    expect((await DELETE(bodyRequest("DELETE", { token }), ctx("d1"))).status).toBe(200);
    expect(listLinks(db, "d1")).toEqual([]);
  });

  it("does not let an edit recipient manage links", async () => {
    upsertShare(db, "d1", BOB.email, "edit");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    expect((await GET(new Request("http://t/api/documents/d1/links"), ctx("d1"))).status).toBe(403);
    expect((await POST(bodyRequest("POST", { access: "view" }), ctx("d1"))).status).toBe(403);
  });

  it("returns identical 404s for foreign and unknown documents", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const foreign = await GET(new Request("http://t/api/documents/d1/links"), ctx("d1"));
    const unknown = await GET(new Request("http://t/api/documents/missing/links"), ctx("missing"));
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("returns 404 for every method when disabled", async () => {
    delete process.env.UNIFIED_DOCS;
    expect((await GET(new Request("http://t/api/documents/d1/links"), ctx("d1"))).status).toBe(404);
    expect((await POST(bodyRequest("POST", { access: "view" }), ctx("d1"))).status).toBe(404);
    expect((await DELETE(bodyRequest("DELETE", { token: "x" }), ctx("d1"))).status).toBe(404);
  });
});
