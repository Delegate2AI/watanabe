import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

// The group rules need the access registry; the route's own job is to call them
// and honour the answer, so the seam is mocked here and unit-tested separately.
const validateShareTargetMock = vi.fn();
vi.mock("@/lib/shared-docs/share-target", () => ({
  validateShareTarget: (...args: unknown[]) => validateShareTargetMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare, getShare, listShares } = await import("@/lib/db/shared-docs");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function body(id: string, method: string, payload?: unknown): Request {
  return new Request(`http://t/api/docs/${id}/shares`, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  // Default: the person rule only, which is all the pre-team cases below need.
  // The real group rules are unit-tested in `lib/shared-docs/share-target.test.ts`.
  validateShareTargetMock.mockReset().mockImplementation(
    (target: { recipient: string; kind: string }, sharer: string) =>
      target.kind === "user" && target.recipient.trim().toLowerCase() === sharer.trim().toLowerCase()
        ? { ok: false, reason: "self" }
        : { ok: true },
  );
  insertSharedDoc(db, { id: "d1", title: "Plan", ownerEmail: ALICE.email, body: "# v1" }, "2026-07-11T00:00:00.000Z");
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("POST /api/docs/[id]/shares (owner adds a share)", () => {
  it("the owner adds a recipient at an access level", async () => {
    const res = await POST(body("d1", "POST", { recipient: DANA.email, access: "comment" }), ctx("d1"));
    expect(res.status).toBe(201);
    expect(getShare(db, "d1", DANA.email)).toBe("comment");
  });

  it("updating an existing recipient changes their access", async () => {
    upsertShare(db, "d1", DANA.email, "view", "2026-07-11T00:00:01.000Z");
    const res = await POST(body("d1", "POST", { recipient: DANA.email, access: "edit" }), ctx("d1"));
    expect(res.status).toBe(201);
    expect(getShare(db, "d1", DANA.email)).toBe("edit");
  });

  it("rejects an invalid access level with 400", async () => {
    const res = await POST(body("d1", "POST", { recipient: DANA.email, access: "admin" }), ctx("d1"));
    expect(res.status).toBe(400);
  });

  it("refuses a self-share (the owner sharing with themselves), writing nothing", async () => {
    const res = await POST(body("d1", "POST", { recipient: ALICE.email, access: "view" }), ctx("d1"));
    expect(res.status).toBe(400);
    expect(getShare(db, "d1", ALICE.email)).toBeNull();
  });

  it("refuses a self-share regardless of address casing", async () => {
    const res = await POST(body("d1", "POST", { recipient: "Alice@Example.com", access: "edit" }), ctx("d1"));
    expect(res.status).toBe(400);
    expect(getShare(db, "d1", ALICE.email)).toBeNull();
  });

  it("a recipient (non-owner) who can read gets 403, not a share write", async () => {
    upsertShare(db, "d1", BOB.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(body("d1", "POST", { recipient: DANA.email, access: "view" }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(getShare(db, "d1", DANA.email)).toBeNull();
  });

  it("a stranger gets 404 (no oracle), not 403", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(body("d1", "POST", { recipient: BOB.email, access: "view" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(getShare(db, "d1", BOB.email)).toBeNull();
  });
});

describe("GET /api/docs/[id]/shares (owner lists shares)", () => {
  it("the owner sees the share list", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    const res = await GET(new Request("http://t/api/docs/d1/shares"), ctx("d1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { shares: Array<{ recipient: string }> };
    expect(data.shares.map((s) => s.recipient)).toEqual([DANA.email]);
  });

  it("a non-owner recipient cannot list shares (403)", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(new Request("http://t/api/docs/d1/shares"), ctx("d1"));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/docs/[id]/shares (owner revokes a share)", () => {
  it("the owner revokes a recipient, removing their access", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    const res = await DELETE(body("d1", "DELETE", { recipient: DANA.email }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(getShare(db, "d1", DANA.email)).toBeNull();
    expect(listShares(db, "d1")).toHaveLength(0);
  });

  it("a non-owner cannot revoke (403)", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    upsertShare(db, "d1", BOB.email, "edit", "2026-07-11T00:00:02.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await DELETE(body("d1", "DELETE", { recipient: DANA.email }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(getShare(db, "d1", DANA.email)).toBe("comment");
  });
});

/**
 * Team recipients. `validateShareTarget` owns the group rules and is unit-tested
 * on its own; what matters here is that the ROUTE routes a group body to it,
 * writes a group-kind row, and refuses on rejection.
 */
describe("team recipients on /api/docs/[id]/shares", () => {
  beforeEach(() => {
    validateShareTargetMock.mockReturnValue({ ok: true });
  });

  it("writes a group-kind row when the target validates", async () => {
    const res = await POST(
      body("d1", "POST", { recipient: "engineering", kind: "group", access: "comment" }),
      ctx("d1"),
    );
    expect(res.status).toBe(201);
    expect(getShare(db, "d1", "engineering", "group")).toBe("comment");
    // And emphatically NOT as a person named "engineering".
    expect(getShare(db, "d1", "engineering", "user")).toBeNull();
  });

  it("refuses the write when the target is rejected, and says why", async () => {
    validateShareTargetMock.mockReturnValue({ ok: false, reason: "group_not_in_clearance" });
    const res = await POST(
      body("d1", "POST", { recipient: "finance", kind: "group", access: "view" }),
      ctx("d1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.detail).toBe("group_not_in_clearance");
    expect(listShares(db, "d1")).toHaveLength(0);
  });

  it("revokes a team grant, and does so even for a target that no longer validates", async () => {
    upsertShare(db, "d1", "retired-team", "view", "2026-07-11T00:00:01.000Z", "group");
    validateShareTargetMock.mockReturnValue({ ok: false, reason: "unknown_group" });
    const res = await DELETE(body("d1", "DELETE", { recipient: "retired-team", kind: "group" }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(listShares(db, "d1")).toHaveLength(0);
  });

  it("rejects an unknown recipient kind at the schema", async () => {
    const res = await POST(
      body("d1", "POST", { recipient: "engineering", kind: "everyone", access: "view" }),
      ctx("d1"),
    );
    expect(res.status).toBe(400);
  });

  it("treats a body with no kind as a person, so a pre-team client still works", async () => {
    const res = await POST(body("d1", "POST", { recipient: DANA.email, access: "view" }), ctx("d1"));
    expect(res.status).toBe(201);
    expect(listShares(db, "d1")[0].recipientKind).toBe("user");
  });
});
