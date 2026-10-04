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
const { insertSharedDoc, upsertShare } = await import("@/lib/db/shared-docs");
const { listPending } = await import("@/lib/db/doc-access-requests");
const { resetRateLimits } = await import("@/lib/http/rate-limit");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(id: string, method: string, payload?: unknown): Request {
  return new Request(`http://t/api/docs/${id}/access-requests`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ACCESS_REQUESTS_ENABLED = "1";
  db = openDb(":memory:");
  resetRateLimits();
  requireIdentityMock.mockReset().mockResolvedValue({ identity: BOB });
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE.email, body: "# v1" }, "2026-08-23T00:00:00.000Z");
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
});

describe("POST /api/docs/[id]/access-requests", () => {
  it("lets someone with no access ask for it", async () => {
    const res = await POST(req("d1", "POST", { access: "comment", message: "for the review" }), ctx("d1"));
    expect(res.status).toBe(201);
    const pending = listPending(db, "d1");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      requesterEmail: BOB.email,
      access: "comment",
      message: "for the review",
      status: "pending",
    });
  });

  it("grants nothing on its own", async () => {
    await POST(req("d1", "POST", { access: "edit" }), ctx("d1"));
    const { accessFor } = await import("@/lib/shared-docs/access");
    expect(accessFor(db, "d1", BOB.email)).toBe("none");
  });

  it("404s an unknown document, so it is no existence oracle for a guessed id", async () => {
    const res = await POST(req("nope", "POST", { access: "view" }), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("404s with the feature flag off", async () => {
    delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(listPending(db, "d1")).toEqual([]);
  });

  it("401s an unauthenticated caller", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(401);
  });

  it("refuses a caller who already has access", async () => {
    upsertShare(db, "d1", BOB.email, "view");
    const res = await POST(req("d1", "POST", { access: "edit" }), ctx("d1"));
    expect(res.status).toBe(409);
    expect(listPending(db, "d1")).toEqual([]);
  });

  it("rejects a level outside the three the ACL knows", async () => {
    const res = await POST(req("d1", "POST", { access: "owner" }), ctx("d1"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/docs/[id]/access-requests", () => {
  it("gives the owner the pending asks", async () => {
    await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    requireIdentityMock.mockResolvedValue({ identity: ALICE });
    const res = await GET(req("d1", "GET"), ctx("d1"));
    expect(res.status).toBe(200);
    const body = await res.json() as { requests: Array<{ requesterEmail: string }> };
    expect(body.requests.map((r) => r.requesterEmail)).toEqual([BOB.email]);
  });

  it("403s a recipient who is not the owner", async () => {
    upsertShare(db, "d1", BOB.email, "edit");
    const res = await GET(req("d1", "GET"), ctx("d1"));
    expect(res.status).toBe(403);
  });

  it("404s a stranger, who must not learn the document exists from this route", async () => {
    const res = await GET(req("d1", "GET"), ctx("d1"));
    expect(res.status).toBe(404);
  });
});
