import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const { insertSharedDoc, upsertShare, removeShare, listComments } = await import("@/lib/db/shared-docs");
const { listThreads: listThreadRows } = await import("@/lib/db/comment-threads");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function post(id: string, payload: unknown): Request {
  return new Request(`http://t/api/docs/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE.email, body: "# v1" }, "2026-07-11T00:00:00.000Z");
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("POST /api/docs/[id]/comments", () => {
  it("a comment-recipient can add a comment", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(post("d1", { body: "looks good", anchor: "para-1" }), ctx("d1"));
    expect(res.status).toBe(201);
    const comments = listComments(db, "d1");
    expect(comments).toHaveLength(1);
    expect(comments[0].authorEmail).toBe(DANA.email);
    expect(comments[0].anchor).toBe("para-1");
  });

  it("an edit-recipient can also comment", async () => {
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(post("d1", { body: "note" }), ctx("d1"));
    expect(res.status).toBe(201);
  });

  it("a view-recipient cannot comment (403), and nothing lands", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(post("d1", { body: "blocked" }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(listComments(db, "d1")).toHaveLength(0);
  });

  it("a stranger gets 404 (no oracle), not 403", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(post("d1", { body: "x" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(listComments(db, "d1")).toHaveLength(0);
  });

  it("rejects an empty comment body with 400", async () => {
    const res = await POST(post("d1", { body: "   " }), ctx("d1"));
    expect(res.status).toBe(400);
  });

  it("refuses a comment when access is REVOKED mid-request (stale-ACL TOCTOU, finding 3)", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    // The revoke lands while the body is being read; the route re-resolves after.
    const racing = {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => {
        removeShare(db, "d1", DANA.email);
        return { body: "should not land" };
      },
    } as unknown as Request;
    const res = await POST(racing, ctx("d1"));
    expect(res.status).toBe(404); // access now "none": same 404, no oracle
    expect(listComments(db, "d1")).toHaveLength(0);
  });
});

describe("GET /api/docs/[id]/comments", () => {
  it("a comment-recipient reads the thread", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    await POST(post("d1", { body: "one" }), ctx("d1"));
    const res = await GET(new Request("http://t/api/docs/d1/comments"), ctx("d1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { comments: Array<{ body: string }> };
    expect(data.comments.map((c) => c.body)).toEqual(["one"]);
  });

  it("a view-recipient cannot read comments (403)", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(new Request("http://t/api/docs/d1/comments"), ctx("d1"));
    expect(res.status).toBe(403);
  });
});

describe("with DOC_ANNOTATIONS_ENABLED", () => {
  beforeEach(() => {
    process.env.DOC_ANNOTATIONS_ENABLED = "1";
  });
  afterEach(() => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
  });

  it("POST creates an anchored thread", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const anchor = { quote: "v1", prefix: "# ", suffix: "", start: 2 };
    const res = await POST(post("d1", { body: "why v1?", anchor }), ctx("d1"));
    expect(res.status).toBe(201);
    const threads = listThreadRows(db, "d1");
    expect(threads).toHaveLength(1);
    expect(threads[0].anchor).toEqual(anchor);
    expect(threads[0].messages[0].body).toBe("why v1?");
  });

  it("GET returns threads not the flat list", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    await POST(post("d1", { body: "hi" }), ctx("d1"));
    const res = await GET(new Request("http://t/api/docs/d1/comments"), ctx("d1"));
    const data = (await res.json()) as { threads: unknown[] };
    expect(Array.isArray(data.threads)).toBe(true);
  });

  it("a view-recipient still gets 403", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(post("d1", { body: "blocked" }), ctx("d1"));
    expect(res.status).toBe(403);
  });
});
