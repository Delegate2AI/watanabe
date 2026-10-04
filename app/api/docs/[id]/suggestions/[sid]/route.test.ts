import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({ requireIdentity: (...a: unknown[]) => requireIdentityMock(...a) }));
let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare, latestBody, getVersions } = await import("@/lib/db/shared-docs");
const { createSuggestion, getSuggestion } = await import("@/lib/db/suggestions");

const ALICE = { email: "alice@example.com", name: "Alice" };
const DANA = { email: "dana@example.com", name: "Dana" };

function ctx(id: string, sid: string) {
  return { params: Promise.resolve({ id, sid }) };
}
function patch(action: string): Request {
  return new Request("http://t/api/docs/d1/suggestions/s1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  insertSharedDoc(db, { id: "d1", title: "P", ownerEmail: ALICE.email, body: "The quick brown fox." }, "2026-07-11T00:00:00.000Z");
  createSuggestion(db, {
    id: "s1", docId: "d1", baseVersion: 1,
    anchor: { quote: "quick brown", prefix: "The ", suffix: " fox", start: 4 },
    originalText: "quick brown", proposedText: "slow red", note: null,
    createdBy: DANA.email, createdAt: "2026-07-11T00:01:00.000Z",
  });
});
afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
});

describe("PATCH accept", () => {
  it("an editor accepts and a new version is spliced", async () => {
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(200);
    expect(latestBody(db, "d1")).toBe("The slow red fox.");
    expect(getSuggestion(db, "s1")!.status).toBe("accepted");
    expect(getVersions(db, "d1")).toHaveLength(2);
  });

  it("a comment-only recipient cannot accept (403)", async () => {
    upsertShare(db, "d1", DANA.email, "comment", "2026-07-11T00:00:01.000Z");
    requireIdentityMock.mockResolvedValue({ identity: DANA });
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(403);
  });

  it("a stale anchor cannot auto-apply (409) and writes no version", async () => {
    // Mutate the body so the quote no longer exists.
    const { addVersion } = await import("@/lib/db/shared-docs");
    addVersion(db, "d1", ALICE.email, "Entirely different text.", { now: "2026-07-11T00:02:00.000Z" });
    const before = getVersions(db, "d1").length;
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(409);
    expect(getSuggestion(db, "s1")!.status).toBe("stale");
    expect(getVersions(db, "d1").length).toBe(before);
  });

  it("refuses to apply once the doc has moved past baseVersion, even if the quote still happens to exist (409)", async () => {
    // The quote is untouched by this edit -- an old locateInSource-only check
    // would happily splice it -- but the document has moved past the version
    // this suggestion was proposed against, so it must be treated as stale.
    const { addVersion } = await import("@/lib/db/shared-docs");
    addVersion(db, "d1", ALICE.email, "The quick brown fox. Extra unrelated line.", { now: "2026-07-11T00:02:00.000Z" });
    const versionsBefore = getVersions(db, "d1").length;
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(409);
    expect(getSuggestion(db, "s1")!.status).toBe("stale");
    expect(getVersions(db, "d1").length).toBe(versionsBefore);
    expect(latestBody(db, "d1")).toBe("The quick brown fox. Extra unrelated line.");
  });

  it("reject marks rejected with no version change", async () => {
    const res = await PATCH(patch("reject"), ctx("d1", "s1"));
    expect(res.status).toBe(200);
    expect(getSuggestion(db, "s1")!.status).toBe("rejected");
    expect(getVersions(db, "d1")).toHaveLength(1);
  });

  it("flag-off is a 404", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(404);
  });

  it("404 when the flag is off, even for an unauthenticated caller (not 401)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("404 when the flag is off, even for a malformed JSON body (not 400)", async () => {
    delete process.env.DOC_ANNOTATIONS_ENABLED;
    const malformed = new Request("http://t/api/docs/d1/suggestions/s1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await PATCH(malformed, ctx("d1", "s1"));
    expect(res.status).toBe(404);
  });

  it("an unknown suggestion id is a 404", async () => {
    const res = await PATCH(patch("accept"), ctx("d1", "nope"));
    expect(res.status).toBe(404);
  });

  it("resolving an already-resolved suggestion is a 409", async () => {
    await PATCH(patch("reject"), ctx("d1", "s1"));
    const res = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(res.status).toBe(409);
  });

  it("calling accept twice: the first succeeds, the second 409s, and only one new version exists", async () => {
    const first = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(first.status).toBe(200);
    const versionsAfterFirst = getVersions(db, "d1").length;

    const second = await PATCH(patch("accept"), ctx("d1", "s1"));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toEqual({ code: "conflict" });

    expect(getVersions(db, "d1").length).toBe(versionsAfterFirst);
    expect(getSuggestion(db, "s1")!.status).toBe("accepted");
  });
});
