import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";

const listOpenMergeRequestsMock = vi.fn();
const getMergeRequestChangesMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    listOpenChangeRequests: (...a: unknown[]) => listOpenMergeRequestsMock(...a),
    getChangeRequestChanges: (...a: unknown[]) => getMergeRequestChangesMock(...a),
  }),
}));

const warnMock = vi.fn();
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: (...a: unknown[]) => warnMock(...a), error: vi.fn() } }));

// Clearance has its own suite. Here it is a switch, so the queue's own filtering
// and enrichment are what the assertions are about.
const clearedForChangesMock = vi.fn<(...a: unknown[]) => boolean>(() => true);
vi.mock("./clearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clearance")>()),
  clearedForChanges: (...a: unknown[]) => clearedForChangesMock(...a),
}));

const { loadProposals, loadProposal } = await import("./queue");
const { openDb } = await import("@/lib/db/client");
const { insertArtifact, updateArtifact, markPublished } = await import("@/lib/db/artifacts");

const ALICE = "alice@example.com";
let db: DatabaseType;

function mr(iid: number, over: Record<string, unknown> = {}) {
  return {
    iid,
    title: `MR ${iid}`,
    description: "Proposed via the KB chat assistant by Alice Doe.",
    sourceBranch: `kb/alice/x-${iid}`,
    authorName: "Portal Bot",
    authorUsername: "portal-bot",
    createdAt: "2026-08-18T10:00:00Z",
    webUrl: `https://gl/mr/${iid}`,
    ...over,
  };
}

/** The shape `getMergeRequestChanges` returns: a change list plus GitLab's truncation flag. */
function changesOf(changes: ReturnType<typeof vaultChange>[], truncated = false) {
  return { changes, truncated };
}

function vaultChange(p = "docs/a.md", over: Record<string, unknown> = {}) {
  return {
    oldPath: p,
    newPath: p,
    diff: "@@\n+x\n",
    newFile: false,
    deletedFile: false,
    renamedFile: false,
    ...over,
  };
}

beforeEach(() => {
  process.env.REPO_WRITE_TOKEN = "tok";
  db = openDb(":memory:");
  listOpenMergeRequestsMock.mockReset().mockResolvedValue([]);
  getMergeRequestChangesMock.mockReset().mockResolvedValue(changesOf([vaultChange()]));
  clearedForChangesMock.mockReset().mockReturnValue(true);
  warnMock.mockReset();
});

afterEach(() => {
  delete process.env.REPO_WRITE_TOKEN;
  db.close();
});

describe("loadProposals", () => {
  it("drops a merge request that touches anything outside the vault", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    getMergeRequestChangesMock.mockResolvedValue(changesOf([
      vaultChange(),
      vaultChange("helm/envs/prod/app.yaml"),
    ]));
    expect(await loadProposals(db, ALICE)).toEqual([]);
  });

  it("drops a merge request whose diff GitLab truncated, since the missing paths could be anywhere", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    getMergeRequestChangesMock.mockResolvedValue(changesOf([vaultChange()], true));
    expect(await loadProposals(db, ALICE)).toEqual([]);
    expect(warnMock).toHaveBeenCalled();
  });

  it("drops a merge request the requester is not cleared for", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    clearedForChangesMock.mockReturnValue(false);
    expect(await loadProposals(db, ALICE)).toEqual([]);
  });

  it("names the human from the description when the proposal came from chat", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal).toMatchObject({
      iid: 1,
      title: "MR 1",
      proposer: "Alice Doe",
      origin: "chat",
      paths: ["docs/a.md"],
      sourceBranch: "kb/alice/x-1",
      createdAt: "2026-08-18T10:00:00Z",
      webUrl: "https://gl/mr/1",
    });
    expect(proposal.changes).toEqual([vaultChange()]);
  });

  it("falls back to the GitLab author when the description names nobody", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1, { description: "No attribution here" })]);
    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal.proposer).toBe("Portal Bot");
  });

  it("lists the old path for a removal, since the new path is empty", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    getMergeRequestChangesMock.mockResolvedValue(changesOf([
      vaultChange("docs/gone.md", { deletedFile: true }),
    ]));
    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal.paths).toEqual(["docs/gone.md"]);
  });

  it("prefers the artifact row's owner over the GitLab author", async () => {
    insertArtifact(db, { id: "art1", title: "N", ownerEmail: ALICE, body: "b" });
    updateArtifact(db, "art1", ALICE, { targetPath: "docs/a.md", status: "ready" });
    markPublished(db, "art1", ALICE, "docs/a.md", "in_review", { url: "https://gl/mr/1", iid: 1 });
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);

    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal).toMatchObject({ proposer: ALICE, origin: "artifact" });
  });

  it("matches a shared-doc publication on the merge request url", async () => {
    const now = "2026-08-18T10:00:00.000Z";
    db.prepare(
      `INSERT INTO shared_docs (id, title, owner_email, created_at, updated_at)
       VALUES ('doc1', 'Doc', @owner, @now, @now)`,
    ).run({ owner: ALICE, now });
    db.prepare(
      `INSERT INTO shared_doc_publications
         (doc_id, status, target_path, target_visibility, published_note_path, mr_url, created_at, updated_at)
       VALUES ('doc1', 'in_review', 'docs/a.md', '["all-hands"]', NULL, 'https://gl/mr/1', @now, @now)`,
    ).run({ now });
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);

    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal).toMatchObject({ proposer: ALICE, origin: "shared-doc" });
  });

  it("skips a merge request whose changes cannot be read rather than failing the whole queue", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1), mr(2)]);
    getMergeRequestChangesMock.mockImplementation(async ({ iid }: { iid: number }) => {
      if (iid === 1) throw new Error("boom");
      return changesOf([vaultChange()]);
    });

    expect((await loadProposals(db, ALICE)).map((p) => p.iid)).toEqual([2]);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("throws when GitLab cannot be listed at all, so the route can report it", async () => {
    listOpenMergeRequestsMock.mockRejectedValue(new Error("unreachable"));
    await expect(loadProposals(db, ALICE)).rejects.toThrow();
  });

  it("is empty with no write token configured", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    expect(await loadProposals(db, ALICE)).toEqual([]);
    expect(listOpenMergeRequestsMock).not.toHaveBeenCalled();
  });

  it("carries the head commit it read, so the merge can be pinned to it", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1, { sha: "deadbeef" })]);
    const [proposal] = await loadProposals(db, ALICE);
    expect(proposal.sha).toBe("deadbeef");
  });
});

describe("loadProposal", () => {
  it("returns the proposal for an iid the requester is cleared for", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1), mr(2)]);
    expect(await loadProposal(db, ALICE, 2)).toMatchObject({ iid: 2 });
  });

  it("returns null for an iid the requester is not cleared for", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    clearedForChangesMock.mockReturnValue(false);
    expect(await loadProposal(db, ALICE, 1)).toBeNull();
  });

  it("returns null for an unknown iid", async () => {
    listOpenMergeRequestsMock.mockResolvedValue([mr(1)]);
    expect(await loadProposal(db, ALICE, 99)).toBeNull();
  });
});
