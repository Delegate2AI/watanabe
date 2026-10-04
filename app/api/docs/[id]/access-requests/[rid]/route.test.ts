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

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare, getShare } = await import("@/lib/db/shared-docs");
const { requestAccess, getRequest } = await import("@/lib/db/doc-access-requests");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string, rid: string) {
  return { params: Promise.resolve({ id, rid }) };
}
function req(id: string, rid: string, payload?: unknown): Request {
  return new Request(`http://t/api/docs/${id}/access-requests/${rid}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

let rid: string;

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ACCESS_REQUESTS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE.email, body: "# v1" }, "2026-08-23T00:00:00.000Z");
  rid = requestAccess(db, { docId: "d1", requesterEmail: BOB.email, access: "comment", message: null }).id;
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
});

describe("POST /api/docs/[id]/access-requests/[rid]", () => {
  it("granting writes the share row at the level asked for", async () => {
    const res = await POST(req("d1", rid, { decision: "granted" }), ctx("d1", rid));
    expect(res.status).toBe(200);
    expect(getShare(db, "d1", BOB.email)).toBe("comment");
    expect(getRequest(db, "d1", rid)).toMatchObject({ status: "granted", decidedBy: ALICE.email });
  });

  it("the owner may grant a different level than the one asked for", async () => {
    await POST(req("d1", rid, { decision: "granted", access: "view" }), ctx("d1", rid));
    expect(getShare(db, "d1", BOB.email)).toBe("view");
  });

  it("declining grants nothing", async () => {
    const res = await POST(req("d1", rid, { decision: "declined", access: "edit" }), ctx("d1", rid));
    expect(res.status).toBe(200);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
    expect(getRequest(db, "d1", rid)?.status).toBe("declined");
  });

  it("409s an already decided request rather than rewriting who decided it", async () => {
    await POST(req("d1", rid, { decision: "declined" }), ctx("d1", rid));
    const res = await POST(req("d1", rid, { decision: "granted" }), ctx("d1", rid));
    expect(res.status).toBe(409);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
  });

  it("403s a recipient with edit access: deciding is the owner's alone", async () => {
    upsertShare(db, "d1", DANA.email, "edit");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(req("d1", rid, { decision: "granted" }), ctx("d1", rid));
    expect(res.status).toBe(403);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
  });

  it("404s a stranger, including the requester themselves", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(req("d1", rid, { decision: "granted" }), ctx("d1", rid));
    expect(res.status).toBe(404);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
  });

  it("404s with the feature flag off", async () => {
    delete process.env.DOC_ACCESS_REQUESTS_ENABLED;
    const res = await POST(req("d1", rid, { decision: "granted" }), ctx("d1", rid));
    expect(res.status).toBe(404);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
  });

  it("404s an unknown request id", async () => {
    const res = await POST(req("d1", "nope", { decision: "granted" }), ctx("d1", "nope"));
    expect(res.status).toBe(404);
  });

  it("rejects a decision it does not know", async () => {
    const res = await POST(req("d1", rid, { decision: "maybe" }), ctx("d1", rid));
    expect(res.status).toBe(400);
    expect(getRequest(db, "d1", rid)?.status).toBe("pending");
  });
});
