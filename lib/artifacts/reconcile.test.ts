import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";

const getMergeRequestMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    getChangeRequestState: (...a: unknown[]) => getMergeRequestMock(...a),
  }),
}));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Promotion is evidence-based: a merge upstream only becomes `published` once
// the note is actually readable in the checkout the KB serves from.
const readVaultFileMock = vi.fn<(rel: string, root: string) => string | null>(() => "# note");
vi.mock("@/lib/vault", () => ({
  readVaultFile: (rel: string, root: string) => readVaultFileMock(rel, root),
}));
vi.mock("@/lib/repo", () => ({ unfilteredVaultRoot: () => "/vault" }));

const { reconcileInReviewArtifacts } = await import("./reconcile");
const { openDb } = await import("@/lib/db/client");
const { insertArtifact, updateArtifact, markPublished, getArtifactForOwner } =
  await import("@/lib/db/artifacts");

const ALICE = "alice@example.com";
const BOB = "bob@example.com";
let db: DatabaseType;

/** An artifact that has opened a merge request and is waiting on review. */
function inReview(id: string, iid: number, owner = ALICE): void {
  insertArtifact(db, { id, title: `Note ${id}`, ownerEmail: owner, body: "body" });
  updateArtifact(db, id, owner, { targetPath: `docs/notes/${id}.md`, status: "ready" });
  markPublished(db, id, owner, `docs/notes/${id}.md`, "in_review", { url: `https://gl/mr/${iid}`, iid });
}

beforeEach(() => {
  process.env.REPO_WRITE_TOKEN = "tok";
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  db = openDb(":memory:");
  getMergeRequestMock.mockReset();
  readVaultFileMock.mockReset().mockReturnValue("# note");
});

afterEach(() => {
  for (const k of ["REPO_WRITE_TOKEN", "ARTIFACTS_ENABLED", "KB_WRITE_ENABLED"]) delete process.env[k];
});

describe("reconcileInReviewArtifacts", () => {
  it("publishes an artifact once its merge request is merged", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 1, rejected: 0, pending: 0 });
    const row = getArtifactForOwner(db, "a1", ALICE);
    expect(row?.status).toBe("published");
    // The note path survives, and so does the merge request: a published
    // artifact should still show the review it went through.
    expect(row?.publishedNotePath).toBe("docs/notes/a1.md");
    expect(row?.mrUrl).toBe("https://gl/mr/7");
    expect(getMergeRequestMock).toHaveBeenCalledWith({ iid: 7, token: "tok" });
  });

  it("hands a closed proposal back to its author as ready, with a clean slate", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "closed" });

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 0, rejected: 1 });
    const row = getArtifactForOwner(db, "a1", ALICE);
    expect(row?.status).toBe("ready");
    // Nothing was published, and the next publish must open a FRESH review
    // rather than pointing at the dead one.
    expect(row?.publishedNotePath).toBeNull();
    expect(row?.mrUrl).toBeNull();
    expect(row?.mrIid).toBeNull();
  });

  it("leaves an open merge request alone", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "opened" });

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 0, rejected: 0, pending: 1 });
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  // `locked` is transient, while GitLab is performing a merge. Treating it as a
  // decision either way would be guessing at a result that is seconds away.
  it("leaves a locked merge request alone", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "locked" });

    await reconcileInReviewArtifacts(db);
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  it("never throws, and changes nothing, when GitLab cannot be reached", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 0, rejected: 0, pending: 1 });
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  it("keeps reconciling the rest when one merge request fails", async () => {
    inReview("a1", 1);
    inReview("a2", 2);
    getMergeRequestMock.mockImplementation(async ({ iid }: { iid: number }) => {
      if (iid === 1) throw new Error("boom");
      return { state: "merged" };
    });

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 1, pending: 1 });
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
    expect(getArtifactForOwner(db, "a2", ALICE)?.status).toBe("published");
  });

  // Reconciliation is a system job with no requester, so it must cross owners.
  it("reconciles artifacts belonging to any owner", async () => {
    inReview("a1", 1, ALICE);
    inReview("b1", 2, BOB);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });

    const result = await reconcileInReviewArtifacts(db);

    expect(result.promoted).toBe(2);
    expect(getArtifactForOwner(db, "b1", BOB)?.status).toBe("published");
  });

  it("does nothing without a write token, rather than failing", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    inReview("a1", 7);

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toEqual({ promoted: 0, rejected: 0, pending: 0 });
    expect(getMergeRequestMock).not.toHaveBeenCalled();
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  it("asks GitLab nothing when no artifact is waiting", async () => {
    insertArtifact(db, { id: "draft", title: "D", ownerEmail: ALICE, body: "b" });

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toEqual({ promoted: 0, rejected: 0, pending: 0 });
    expect(getMergeRequestMock).not.toHaveBeenCalled();
  });

  it("skips an in-review artifact with no iid, since there is nothing to ask about", async () => {
    insertArtifact(db, { id: "legacy", title: "L", ownerEmail: ALICE, body: "b" });
    updateArtifact(db, "legacy", ALICE, { targetPath: "docs/x.md", status: "ready" });
    markPublished(db, "legacy", ALICE, "docs/x.md", "in_review", null);

    const result = await reconcileInReviewArtifacts(db);

    expect(getMergeRequestMock).not.toHaveBeenCalled();
    expect(result.pending).toBe(0);
    expect(getArtifactForOwner(db, "legacy", ALICE)?.status).toBe("in_review");
  });

  it("is idempotent: a second pass over an already-published artifact is a no-op", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });

    await reconcileInReviewArtifacts(db);
    const second = await reconcileInReviewArtifacts(db);

    expect(second).toEqual({ promoted: 0, rejected: 0, pending: 0 });
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("published");
  });

  // The bug this whole branch began with was an artifact reported as published
  // whose note the knowledge base could not find. `refreshRepo()` swallows every
  // failure by contract, so having called it proves nothing.
  it("leaves a merged artifact pending while its note is not yet in the checkout", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });
    readVaultFileMock.mockReturnValue(null);

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toMatchObject({ promoted: 0, pending: 1 });
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  it("promotes on a later pass, once the checkout has caught up", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });

    readVaultFileMock.mockReturnValue(null);
    await reconcileInReviewArtifacts(db);
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");

    readVaultFileMock.mockReturnValue("# note");
    await reconcileInReviewArtifacts(db);
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("published");
  });

  it("reads the note from the vault root, stripping the docs/ prefix", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "merged" });

    await reconcileInReviewArtifacts(db);
    expect(readVaultFileMock).toHaveBeenCalledWith("notes/a1.md", "/vault");
  });

  // A closed merge request is a decision about a note that was never published,
  // so it needs no checkout evidence.
  it("still rejects a closed proposal even when nothing is in the checkout", async () => {
    inReview("a1", 7);
    getMergeRequestMock.mockResolvedValue({ state: "closed" });
    readVaultFileMock.mockReturnValue(null);

    await reconcileInReviewArtifacts(db);
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("ready");
  });

  it("does nothing at all when the artifacts subsystem is switched off", async () => {
    delete process.env.ARTIFACTS_ENABLED;
    inReview("a1", 7);

    const result = await reconcileInReviewArtifacts(db);

    expect(result).toEqual({ promoted: 0, rejected: 0, pending: 0 });
    expect(getMergeRequestMock).not.toHaveBeenCalled();
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
  });

  it("does nothing when the knowledge base write path is switched off", async () => {
    delete process.env.KB_WRITE_ENABLED;
    inReview("a1", 7);

    await reconcileInReviewArtifacts(db);
    expect(getMergeRequestMock).not.toHaveBeenCalled();
  });
});
