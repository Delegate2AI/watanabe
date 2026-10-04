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

const { POST, GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { listSharedByOwner, upsertShare, getSharedDoc, latestBody } = await import("@/lib/db/shared-docs");
const { insertArtifact } = await import("@/lib/db/artifacts");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function post(body: unknown): Request {
  return new Request("http://t/api/docs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
});

describe("POST /api/docs (create)", () => {
  it("is a 404 empty surface when the flag is off", async () => {
    const res = await POST(post({ title: "T", body: "b" }));
    expect(res.status).toBe(404);
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("creates a doc owned by the caller with version 1 when enabled", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    const res = await POST(post({ title: "Launch plan", body: "# hi" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(getSharedDoc(db, id)?.ownerEmail).toBe(ALICE.email);
    expect(getSharedDoc(db, id)?.title).toBe("Launch plan");
    expect(latestBody(db, id)).toBe("# hi");
  });

  it("rejects an empty body with 400", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    const res = await POST(post({ title: "T", body: "   " }));
    expect(res.status).toBe(400);
  });

  it("401 when there is no identity", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no id" }, { status: 401 }) });
    const res = await POST(post({ title: "T", body: "b" }));
    expect(res.status).toBe(401);
  });

  it("400 when neither a body nor an artifact is provided", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    const res = await POST(post({ title: "T" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/docs (seed from an artifact, spec 27 -> 28)", () => {
  it("seeds a new shared doc from an artifact the caller owns", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    insertArtifact(db, { id: "art1", title: "Risk memo", ownerEmail: ALICE.email, body: "# artifact body" });
    const res = await POST(post({ fromArtifactId: "art1" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(getSharedDoc(db, id)?.title).toBe("Risk memo");
    expect(getSharedDoc(db, id)?.ownerEmail).toBe(ALICE.email);
    expect(latestBody(db, id)).toBe("# artifact body");
  });

  it("404s seeding from an artifact the caller does not own (no oracle)", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    insertArtifact(db, { id: "art1", title: "Bob's", ownerEmail: BOB.email, body: "# bobs" });
    const res = await POST(post({ fromArtifactId: "art1" }));
    expect(res.status).toBe(404);
    expect(listSharedByOwner(db, ALICE.email)).toHaveLength(0);
  });

  it("404s seeding from an unknown artifact IDENTICALLY", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    const res = await POST(post({ fromArtifactId: "ghost" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/docs (list, split by/with me)", () => {
  it("splits docs I own from docs shared with me", async () => {
    process.env.SHARED_DOCS_ENABLED = "1";
    // Alice creates one.
    const mine = await POST(post({ title: "Mine", body: "b" }));
    const { id: mineId } = (await mine.json()) as { id: string };
    // Bob creates one and shares it with Alice.
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const bobs = await POST(post({ title: "Bob's", body: "b" }));
    const { id: bobsId } = (await bobs.json()) as { id: string };
    upsertShare(db, bobsId, ALICE.email, "comment", "2026-07-11T00:00:01.000Z");
    // Alice lists.
    requireIdentityMock.mockResolvedValue({ identity: ALICE });
    const res = await GET(new Request("http://t/api/docs"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      sharedByMe: Array<{ id: string }>;
      sharedWithMe: Array<{ id: string; access: string }>;
    };
    expect(data.sharedByMe.map((d) => d.id)).toEqual([mineId]);
    expect(data.sharedWithMe.map((d) => d.id)).toEqual([bobsId]);
    expect(data.sharedWithMe[0].access).toBe("comment");
  });

  it("404 when the flag is off (route did not exist pre-feature; not a 200 empty)", async () => {
    // No SHARED_DOCS_ENABLED in this block.
    const res = await GET(new Request("http://t/api/docs"));
    expect(res.status).toBe(404);
  });
});
