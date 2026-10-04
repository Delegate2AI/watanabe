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

const { GET, POST, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare, getLink, listLinks } = await import("@/lib/db/shared-docs");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(id: string, method: string, payload?: unknown): Request {
  return new Request(`http://t/api/docs/${id}/links`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.EXTERNAL_SHARE_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE.email, body: "# v1" }, "2026-07-11T00:00:00.000Z");
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.EXTERNAL_SHARE_ENABLED;
});

describe("POST /api/docs/[id]/links (owner mints an external link)", () => {
  it("mints a view link with a strong token and an expiry", async () => {
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { token: string; access: string; expiresAt: string | null };
    expect(data.access).toBe("view");
    expect(data.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.expiresAt).not.toBeNull();
    expect(getLink(db, data.token)?.docId).toBe("d1");
  });

  it("mints a comment link", async () => {
    const res = await POST(req("d1", "POST", { access: "comment" }), ctx("d1"));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { access: string }).access).toBe("comment");
  });

  it("refuses an edit link (400): links are view/comment only, never edit", async () => {
    const res = await POST(req("d1", "POST", { access: "edit" }), ctx("d1"));
    expect(res.status).toBe(400);
    expect(listLinks(db, "d1")).toHaveLength(0);
  });

  it("is a 404 when EXTERNAL_SHARE_ENABLED is off (even with shared docs on)", async () => {
    delete process.env.EXTERNAL_SHARE_ENABLED;
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(listLinks(db, "d1")).toHaveLength(0);
  });

  it("a non-owner recipient cannot mint (403)", async () => {
    upsertShare(db, "d1", BOB.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(listLinks(db, "d1")).toHaveLength(0);
  });

  it("a stranger gets 404 (no oracle)", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    expect(res.status).toBe(404);
  });
});

describe("GET/DELETE /api/docs/[id]/links (owner manages links)", () => {
  it("the owner lists then revokes a link", async () => {
    const minted = await POST(req("d1", "POST", { access: "view" }), ctx("d1"));
    const { token } = (await minted.json()) as { token: string };
    const list = await GET(new Request("http://t/api/docs/d1/links"), ctx("d1"));
    expect(((await list.json()) as { links: unknown[] }).links).toHaveLength(1);
    const del = await DELETE(req("d1", "DELETE", { token }), ctx("d1"));
    expect(del.status).toBe(200);
    expect(getLink(db, token)).toBeNull();
  });

  it("a non-owner cannot list links (403)", async () => {
    upsertShare(db, "d1", BOB.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(new Request("http://t/api/docs/d1/links"), ctx("d1"));
    expect(res.status).toBe(403);
  });

  it("cross-document revocation is impossible: doc A's endpoint cannot revoke doc B's token (finding 1)", async () => {
    // Bob owns d2 and mints a link there.
    insertSharedDoc(db, { id: "d2", title: "Bob's", ownerEmail: BOB.email, body: "b" }, "2026-07-11T00:00:00.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const minted = await POST(req("d2", "POST", { access: "view" }), ctx("d2"));
    const { token: bobToken } = (await minted.json()) as { token: string };
    // Alice, owner of d1, calls HER endpoint with Bob's d2 token.
    requireIdentityMock.mockResolvedValue({ identity: ALICE });
    const res = await DELETE(req("d1", "DELETE", { token: bobToken }), ctx("d1"));
    expect(res.status).toBe(200); // her request is well-formed and authorized for d1
    // But Bob's link is untouched: the delete was scoped to d1, matched nothing.
    expect(getLink(db, bobToken)?.docId).toBe("d2");
  });
});
