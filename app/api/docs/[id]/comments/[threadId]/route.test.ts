import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({ requireIdentity: (...a: unknown[]) => requireIdentityMock(...a) }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare } = await import("@/lib/db/shared-docs");
const { createThread, listThreads } = await import("@/lib/db/comment-threads");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function ctx(id: string, threadId: string) {
  return { params: Promise.resolve({ id, threadId }) };
}
function req(method: string, payload: unknown): Request {
  return new Request("http://t/api/docs/d1/comments/t1", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: ALICE.email, body: "# b" }, "2026-07-11T00:00:00.000Z");
  createThread(db, {
    id: "t1",
    docId: "d1",
    anchor: null,
    createdBy: ALICE.email,
    createdAt: "2026-07-11T00:01:00.000Z",
    body: "one",
    messageId: "m1",
  });
});
afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
});

describe("POST reply", () => {
  it("a comment-recipient can reply", async () => {
    upsertShare(db, "d1", BOB.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(req("POST", { body: "two" }), ctx("d1", "t1"));
    expect(res.status).toBe(201);
    expect(listThreads(db, "d1")[0].messages.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("404 for an unknown thread", async () => {
    const res = await POST(req("POST", { body: "x" }), ctx("d1", "nope"));
    expect(res.status).toBe(404);
  });

  it("a view-recipient gets 403, and nothing lands", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(req("POST", { body: "blocked" }), ctx("d1", "t1"));
    expect(res.status).toBe(403);
    expect(listThreads(db, "d1")[0].messages).toHaveLength(1);
  });

  it("rejects an empty reply body with 400", async () => {
    const res = await POST(req("POST", { body: "   " }), ctx("d1", "t1"));
    expect(res.status).toBe(400);
  });

  it("404 when the flag is off", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const res = await POST(req("POST", { body: "x" }), ctx("d1", "t1"));
    expect(res.status).toBe(404);
  });

  it("404 when the flag is off, even for an unauthenticated caller (not 401)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(req("POST", { body: "x" }), ctx("d1", "t1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("404 when the flag is off, even for a malformed JSON body (not 400)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const malformed = new Request("http://t/api/docs/d1/comments/t1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(malformed, ctx("d1", "t1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH resolve", () => {
  it("resolves then reopens", async () => {
    let res = await PATCH(req("PATCH", { status: "resolved" }), ctx("d1", "t1"));
    expect(res.status).toBe(200);
    let t = listThreads(db, "d1")[0];
    expect(t.status).toBe("resolved");
    expect(t.resolvedBy).toBe(ALICE.email);

    res = await PATCH(req("PATCH", { status: "open" }), ctx("d1", "t1"));
    expect(res.status).toBe(200);
    t = listThreads(db, "d1")[0];
    expect(t.status).toBe("open");
    expect(t.resolvedBy).toBeNull();
  });

  it("404 for an unknown thread", async () => {
    const res = await PATCH(req("PATCH", { status: "resolved" }), ctx("d1", "nope"));
    expect(res.status).toBe(404);
  });

  it("rejects an invalid status with 400", async () => {
    const res = await PATCH(req("PATCH", { status: "closed" }), ctx("d1", "t1"));
    expect(res.status).toBe(400);
  });

  it("404 when the flag is off, even for an unauthenticated caller (not 401)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await PATCH(req("PATCH", { status: "resolved" }), ctx("d1", "t1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("404 when the flag is off, even for a malformed JSON body (not 400)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const malformed = new Request("http://t/api/docs/d1/comments/t1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PATCH(malformed, ctx("d1", "t1"));
    expect(res.status).toBe(404);
  });
});

describe("cross-document IDOR", () => {
  it("a thread id from a different document 404s and mutates nothing, for both reply and resolve", async () => {
    insertSharedDoc(db, { id: "d2", title: "Other", ownerEmail: ALICE.email, body: "# other" }, "2026-07-11T00:00:00.000Z");
    createThread(db, {
      id: "t-b",
      docId: "d2",
      anchor: null,
      createdBy: ALICE.email,
      createdAt: "2026-07-11T00:01:00.000Z",
      body: "d2's thread",
      messageId: "m-b1",
    });
    // Alice has comment access to d1 (she owns it) but the thread belongs to d2.
    const replyRes = await POST(req("POST", { body: "sneaking in" }), ctx("d1", "t-b"));
    expect(replyRes.status).toBe(404);
    expect(listThreads(db, "d2")[0].messages).toHaveLength(1);

    const resolveRes = await PATCH(req("PATCH", { status: "resolved" }), ctx("d1", "t-b"));
    expect(resolveRes.status).toBe(404);
    expect(listThreads(db, "d2")[0].status).toBe("open");
  });
});
