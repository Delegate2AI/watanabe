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

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { addPublication, createDocument, getDocument, listVersions, upsertShare } = await import("@/lib/documents/store");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function post(body: unknown): Request {
  return new Request("http://t/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.UNIFIED_DOCS;
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});

afterEach(() => {
  delete process.env.UNIFIED_DOCS;
});

describe("/api/documents flag gate", () => {
  it("returns 404 for GET and POST when disabled", async () => {
    expect((await GET(new Request("http://t/api/documents"))).status).toBe(404);
    expect((await POST(post({ title: "T", body: "b" }))).status).toBe(404);
  });
});

describe("POST /api/documents", () => {
  it("creates an owner document with version one", async () => {
    process.env.UNIFIED_DOCS = "1";
    const res = await POST(post({ title: "Launch plan", body: "# v1" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(getDocument(db, id)?.ownerEmail).toBe(ALICE.email);
    expect(listVersions(db, id).map((version) => version.body)).toEqual(["# v1"]);
  });

  it("rejects empty input", async () => {
    process.env.UNIFIED_DOCS = "1";
    expect((await POST(post({ title: "", body: "" }))).status).toBe(400);
  });
});

describe("GET /api/documents", () => {
  it("lists owned and shared-with documents with dispositions", async () => {
    process.env.UNIFIED_DOCS = "1";
    createDocument(db, { id: "mine", ownerEmail: ALICE.email, title: "Mine", body: "m", originThreadId: null });
    createDocument(db, { id: "shared", ownerEmail: BOB.email, title: "Shared", body: "s", originThreadId: null });
    createDocument(db, { id: "hidden", ownerEmail: BOB.email, title: "Hidden", body: "h", originThreadId: null });
    upsertShare(db, "shared", ALICE.email, "comment");
    addPublication(db, { docId: "mine", status: "draft", targetPath: null, targetVisibility: null, publishedNotePath: null });

    const res = await GET(new Request("http://t/api/documents"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { documents: Array<{ id: string; access: string; disposition: { shared: boolean; published: boolean } }> };
    expect(data.documents.map((doc) => doc.id).sort()).toEqual(["mine", "shared"]);
    expect(data.documents.find((doc) => doc.id === "mine")).toMatchObject({ access: "owner", disposition: { shared: false, published: true } });
    expect(data.documents.find((doc) => doc.id === "shared")).toMatchObject({ access: "comment", disposition: { shared: true, published: false } });
  });
});
