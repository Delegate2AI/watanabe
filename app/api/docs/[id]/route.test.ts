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

const { GET, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare, removeShare, addVersion, latestBody, getVersions } = await import(
  "@/lib/db/shared-docs"
);

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patch(id: string, body: unknown): Request {
  return new Request(`http://t/api/docs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

describe("GET /api/docs/[id] (read, ACL-gated)", () => {
  it("the owner reads the doc, body, and (owner-only) version history", async () => {
    addVersion(db, "d1", ALICE.email, "# v2", { now: "2026-07-11T01:00:00.000Z" });
    const res = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { access: string; body: string; versions: Array<{ authorEmail: string }> };
    expect(data.access).toBe("owner");
    expect(data.body).toBe("# v2");
    expect(data.versions).toHaveLength(2);
    expect(data.versions[0].authorEmail).toBe(ALICE.email);
  });

  it("a view-recipient gets the current body only, NO version history or author emails (finding 2)", async () => {
    addVersion(db, "d1", ALICE.email, "# v2 secret history", { now: "2026-07-11T01:00:00.000Z" });
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    expect(res.status).toBe(200);
    const raw = await res.text();
    const data = JSON.parse(raw) as { access: string; body: string; versions?: unknown };
    expect(data.access).toBe("view");
    expect(data.body).toBe("# v2 secret history"); // current body is fine
    expect(data.versions).toBeUndefined(); // but no history
    expect(raw).not.toContain("authorEmail"); // and no per-version author disclosure
  });

  it("a comment-recipient also gets no version history", async () => {
    addVersion(db, "d1", ALICE.email, "# v2", { now: "2026-07-11T01:00:00.000Z" });
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    const data = (await res.json()) as { versions?: unknown };
    expect(data.versions).toBeUndefined();
  });

  it("an edit-recipient also gets no version history", async () => {
    addVersion(db, "d1", ALICE.email, "# v2", { now: "2026-07-11T01:00:00.000Z" });
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    const data = (await res.json()) as { versions?: unknown };
    expect(data.versions).toBeUndefined();
  });

  it("a stranger and an unknown id both 404 identically (no oracle)", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const foreign = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    const unknown = await GET(new Request("http://t/api/docs/ghost"), ctx("ghost"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("404 when the flag is off", async () => {
    delete process.env.SHARED_DOCS_ENABLED;
    const res = await GET(new Request("http://t/api/docs/d1"), ctx("d1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/docs/[id] (edit, appends a version)", () => {
  it("the owner's edit appends a version and advances the latest", async () => {
    const res = await PATCH(patch("d1", { body: "# v2" }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(latestBody(db, "d1")).toBe("# v2");
    expect(getVersions(db, "d1")).toHaveLength(2);
  });

  it("an edit-recipient can append a version authored under their email", async () => {
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await PATCH(patch("d1", { body: "# danas edit" }), ctx("d1"));
    expect(res.status).toBe(200);
    const versions = getVersions(db, "d1");
    expect(versions).toHaveLength(2);
    expect(versions[1].authorEmail).toBe(DANA.email);
  });

  it("a comment-recipient cannot edit (403), and nothing lands", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await PATCH(patch("d1", { body: "# sneaky" }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(latestBody(db, "d1")).toBe("# v1");
  });

  it("a view-recipient cannot edit (403)", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await PATCH(patch("d1", { body: "# nope" }), ctx("d1"));
    expect(res.status).toBe(403);
    expect(latestBody(db, "d1")).toBe("# v1");
  });

  it("a stranger patching gets 404 (no oracle), not 403", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await PATCH(patch("d1", { body: "# x" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(latestBody(db, "d1")).toBe("# v1");
  });

  it("the owner can rename the doc", async () => {
    const res = await PATCH(patch("d1", { title: "Renamed" }), ctx("d1"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { title: string }).title).toBe("Renamed");
  });

  // Finding 3 (TOCTOU): access is re-resolved AFTER the body is read. Simulate a
  // revoke/downgrade that lands while the body is in flight by mutating the ACL
  // inside request.json(), then assert the write is refused on the fresh ACL.
  function racingPatch(payload: unknown, sideEffect: () => void): Request {
    return {
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => {
        sideEffect();
        return payload;
      },
    } as unknown as Request;
  }

  it("refuses an edit when the share is REVOKED mid-request (stale-ACL TOCTOU)", async () => {
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const req = racingPatch({ body: "# should not land" }, () => removeShare(db, "d1", DANA.email));
    const res = await PATCH(req, ctx("d1"));
    expect(res.status).toBe(404); // access is now "none": same 404, no oracle
    expect(latestBody(db, "d1")).toBe("# v1");
  });

  it("refuses an edit when access is DOWNGRADED to comment mid-request", async () => {
    upsertShare(db, "d1", DANA.email, "edit", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const req = racingPatch({ body: "# should not land" }, () =>
      upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:02.000Z"),
    );
    const res = await PATCH(req, ctx("d1"));
    expect(res.status).toBe(403); // can still read, but no longer edit
    expect(latestBody(db, "d1")).toBe("# v1");
  });
});
