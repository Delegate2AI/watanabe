import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({ requireIdentity: (...a: unknown[]) => requireIdentityMock(...a) }));
let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare } = await import("@/lib/db/shared-docs");
const { listSuggestions } = await import("@/lib/db/suggestions");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };
const DANA = { email: "dana@example.com", name: "Dana" };
const ANCHOR = { quote: "v1", prefix: "# ", suffix: "", start: 2 };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function post(id: string, payload: unknown): Request {
  return new Request(`http://t/api/docs/${id}/suggestions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: ALICE.email, body: "# v1" }, "2026-07-11T00:00:00.000Z");
});
afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
});

describe("POST suggestion", () => {
  it("a comment-recipient can propose", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2", note: "clearer" }), ctx("d1"));
    expect(res.status).toBe(201);
    expect(listSuggestions(db, "d1")).toHaveLength(1);
  });
  it("a view-recipient cannot (403)", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2" }), ctx("d1"));
    expect(res.status).toBe(403);
  });
  it("flag-off is a 404", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const res = await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2" }), ctx("d1"));
    expect(res.status).toBe(404);
  });

  it("404 when the flag is off, even for an unauthenticated caller (not 401)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("404 when the flag is off, even for a malformed JSON body (not 400)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const malformed = new Request("http://t/api/docs/d1/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(malformed, ctx("d1"));
    expect(res.status).toBe(404);
  });
  it("a stranger gets 404 (no oracle), not 403", async () => {
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2" }), ctx("d1"));
    expect(res.status).toBe(404);
    expect(listSuggestions(db, "d1")).toHaveLength(0);
  });
  it("rejects an invalid body with 400", async () => {
    const res = await POST(post("d1", { originalText: "v1" }), ctx("d1"));
    expect(res.status).toBe(400);
  });

  it("rejects a quote that cannot be located in the current body (400), storing nothing", async () => {
    const badAnchor = { quote: "not in the document anywhere", prefix: "", suffix: "", start: 0 };
    const res = await POST(post("d1", { anchor: badAnchor, proposedText: "x" }), ctx("d1"));
    expect(res.status).toBe(400);
    expect(listSuggestions(db, "d1")).toHaveLength(0);
  });

  it("ignores a client-supplied originalText and stores the anchor's quote instead", async () => {
    const res = await POST(
      post("d1", { anchor: ANCHOR, originalText: "recieve", proposedText: "mallory@example.com", note: "typo" }),
      ctx("d1"),
    );
    expect(res.status).toBe(201);
    const stored = listSuggestions(db, "d1")[0];
    expect(stored.originalText).toBe(ANCHOR.quote);
    expect(stored.originalText).not.toBe("recieve");
  });
});

describe("GET suggestions", () => {
  it("a comment-recipient lists suggestions", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    await POST(post("d1", { anchor: ANCHOR, originalText: "v1", proposedText: "v2" }), ctx("d1"));
    const res = await GET(new Request("http://t/api/docs/d1/suggestions"), ctx("d1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { suggestions: Array<{ proposedText: string }> };
    expect(data.suggestions.map((s) => s.proposedText)).toEqual(["v2"]);
  });

  it("a view-recipient cannot read suggestions (403)", async () => {
    upsertShare(db, "d1", BOB.email, "view", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await GET(new Request("http://t/api/docs/d1/suggestions"), ctx("d1"));
    expect(res.status).toBe(403);
  });

  it("flag-off is a 404", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const res = await GET(new Request("http://t/api/docs/d1/suggestions"), ctx("d1"));
    expect(res.status).toBe(404);
  });

  it("404 when the flag is off, even for an unauthenticated caller (not 401)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await GET(new Request("http://t/api/docs/d1/suggestions"), ctx("d1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });
});
