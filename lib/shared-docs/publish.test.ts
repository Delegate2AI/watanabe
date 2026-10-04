import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const publishCoreMock = vi.fn();
vi.mock("@/lib/kb-write/publish-core", () => ({
  publishCore: (...args: unknown[]) => publishCoreMock(...args),
}));

const canMock = vi.fn(() => true);
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...(args as [])) }));

const effectiveCanWriteMock = vi.fn(() => true);
vi.mock("@/lib/authority/write-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/write-gate")>();
  return { ...actual, effectiveCanWrite: () => effectiveCanWriteMock() };
});

const { publishSharedDoc } = await import("./publish");
const { openDb } = await import("@/lib/db/client");
const { insertSharedDoc, upsertShare } = await import("@/lib/db/shared-docs");
const { getPublication } = await import("@/lib/db/shared-doc-publications");

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";

let db: import("better-sqlite3").Database;

const MR_OK = { ok: true, mode: "mr", branch: "kb/owner/doc-1", mrUrl: "https://git/mr/1", mrIid: 1, notePath: "docs/handbook/onboarding.md" };

function publish(overrides: Partial<Parameters<typeof publishSharedDoc>[1]> = {}) {
  return publishSharedDoc(db, {
    id: "doc-1",
    actorEmail: OWNER,
    mode: "mr",
    targetPath: "handbook/onboarding.md",
    targetVisibility: ["all-hands"],
    ...overrides,
  });
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.SHARED_DOC_PUBLISH_ENABLED = "1";
  process.env.REPO_WRITE_TOKEN = "test-token";
  db = openDb(":memory:");
  insertSharedDoc(db, { id: "doc-1", title: "Onboarding", ownerEmail: OWNER, body: "The body." });
  publishCoreMock.mockReset().mockResolvedValue(MR_OK);
  canMock.mockReset().mockReturnValue(true);
  effectiveCanWriteMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.KB_WRITE_ENABLED;
  delete process.env.SHARED_DOC_PUBLISH_ENABLED;
  delete process.env.REPO_WRITE_TOKEN;
});

describe("publishSharedDoc", () => {
  it("publishes the latest body through the write path and records the review", async () => {
    const result = await publish();

    expect(result.ok).toBe(true);
    expect(publishCoreMock).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeKey: "shared-doc-doc-1",
        body: "The body.",
        targetRel: "handbook/onboarding.md",
        mode: "mr",
      }),
    );
    const publication = getPublication(db, "doc-1");
    // in_review, not published: the note is not in the KB until someone merges.
    expect(publication?.status).toBe("in_review");
    expect(publication?.mrUrl).toBe("https://git/mr/1");
    expect(publication?.targetVisibility).toEqual(["all-hands"]);
  });

  it("refuses a recipient with edit access, who may edit but not file it in the vault", async () => {
    upsertShare(db, "doc-1", EDITOR, "edit");

    const result = await publish({ actorEmail: EDITOR });

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(getPublication(db, "doc-1")).toBeNull();
    expect(publishCoreMock).not.toHaveBeenCalled();
  });

  it("refuses a direct publish without the approver role", async () => {
    canMock.mockReturnValue(false);

    const result = await publish({ mode: "direct" });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(publishCoreMock).not.toHaveBeenCalled();
  });

  it("refuses an owner who does not hold the write role", async () => {
    effectiveCanWriteMock.mockReturnValue(false);

    expect(await publish()).toMatchObject({ ok: false, status: 403 });
    expect(publishCoreMock).not.toHaveBeenCalled();
  });

  it("is dark with the flag off", async () => {
    delete process.env.SHARED_DOC_PUBLISH_ENABLED;

    expect(await publish()).toMatchObject({ ok: false, status: 404 });
    expect(publishCoreMock).not.toHaveBeenCalled();
  });

  it("supersedes the previous publication when a later revision is published", async () => {
    await publish();
    publishCoreMock.mockResolvedValue({ ...MR_OK, mrUrl: "https://git/mr/2", branch: "kb/owner/doc-2" });

    const second = await publish();

    // A shared doc keeps living, unlike an artifact: a second publish is a new
    // merge request for the document as it now stands, not a refusal.
    expect(second.ok).toBe(true);
    const publication = getPublication(db, "doc-1");
    expect(publication?.mrUrl).toBe("https://git/mr/2");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM shared_doc_publications`).get()).toEqual({ n: 1 });
  });

  it("records nothing when the write path fails, so no document claims a review that does not exist", async () => {
    publishCoreMock.mockResolvedValue({ ok: false, status: 409, error: "merge conflict in: a.md" });

    expect(await publish()).toMatchObject({ ok: false, status: 409 });
    expect(getPublication(db, "doc-1")).toBeNull();
  });

  it("answers 404 for an unknown document, the same as one that is not the caller's", async () => {
    expect(await publish({ id: "nope" })).toMatchObject({ ok: false, status: 404 });
  });
});
