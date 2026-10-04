import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";

// The write path and GitLab are mocked; the role gate, the note builder, the
// on-disk write, and the DB all run for real, so these tests exercise the
// actual publish orchestration (containment, note frontmatter, status flip),
// not just its branching.
const ensureWorktreeMock = vi.fn();
const worktreeExistsMock = vi.fn(() => false);
const submitMock = vi.fn();
const discardMock = vi.fn();
let vaultRoot: string;
vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...a: unknown[]) => ensureWorktreeMock(...a),
  worktreeExists: (...a: unknown[]) => worktreeExistsMock(...a),
  worktreeVaultRoot: () => vaultRoot,
  submit: (...a: unknown[]) => submitMock(...a),
  discard: (...a: unknown[]) => discardMock(...a),
}));

const createMergeRequestMock = vi.fn();
const getMergeRequestMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (...a: unknown[]) => createMergeRequestMock(...a),
    getChangeRequestState: (...a: unknown[]) => getMergeRequestMock(...a),
  }),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...a: unknown[]) => canMock(...a),
  isRolesEnabled: () => true,
}));

// A direct publish fast-forwards the read-serving checkout so the KB view can
// actually see the note it just wrote; mocked here so the tests never shell out
// to git, and asserted on below because "published but invisible" was the bug.
const refreshRepoMock = vi.fn(async () => {});
vi.mock("@/lib/repo", () => ({
  refreshRepo: () => refreshRepoMock(),
  // The reconciler will not call a merge published until the note is really
  // readable, so point it at the same tmp vault the publish just wrote into.
  // The round trip then verifies the actual file, not a stub.
  unfilteredVaultRoot: () => vaultRoot,
}));
const rebuildIndexMock = vi.fn();
vi.mock("@/lib/index/cache", () => ({
  rebuildIndex: (...a: unknown[]) => rebuildIndexMock(...a),
}));
vi.mock("@/lib/index/config", () => ({ isIndexEnabled: () => false }));

const { publishArtifact } = await import("./publish");
const { reconcileInReviewArtifacts } = await import("./reconcile");
const { openDb } = await import("@/lib/db/client");
const { insertArtifact, updateArtifact, getArtifactForOwner } = await import("@/lib/db/artifacts");

const ALICE = "alice@example.com";
let db: DatabaseType;
let tmpRoot: string;

function readyArtifact(id = "a1", targetPath = "docs/notes/risk.md", visibility = ["exec"]) {
  insertArtifact(db, { id, title: "Risk Disclosure", ownerEmail: ALICE, body: "# Risk\n\nBody text." });
  updateArtifact(db, id, ALICE, { targetPath, targetVisibility: visibility, status: "ready" });
}

beforeEach(() => {
  process.env.ARTIFACTS_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
  process.env.REPO_WRITE_TOKEN = "tok";
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-publish-"));
  vaultRoot = tmpRoot;
  db = openDb(":memory:");
  ensureWorktreeMock.mockReset().mockResolvedValue(tmpRoot);
  worktreeExistsMock.mockReset().mockReturnValue(false);
  submitMock.mockReset().mockResolvedValue({ ok: true, branch: "kb/alice/risk-disclosure-1" });
  discardMock.mockReset().mockResolvedValue(undefined);
  createMergeRequestMock.mockReset().mockResolvedValue({ webUrl: "https://gl/mr/1", iid: 1 });
  getMergeRequestMock.mockReset();
  canMock.mockReset().mockReturnValue(true);
  refreshRepoMock.mockClear();
  rebuildIndexMock.mockClear();
});

afterEach(() => {
  for (const k of ["ARTIFACTS_ENABLED", "KB_WRITE_ENABLED", "ROLES_ENABLED", "REPO_WRITE_TOKEN"]) delete process.env[k];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("publishArtifact", () => {
  it("editor publishes via mr, writing a note whose visibility = target_visibility, and marks it in review", async () => {
    canMock.mockImplementation((_e: string, cap: string) => cap === "write");
    readyArtifact();
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: true, mode: "mr", mrUrl: "https://gl/mr/1", notePath: "docs/notes/risk.md" });

    const written = fs.readFileSync(path.join(tmpRoot, "notes/risk.md"), "utf8");
    expect(written).toMatch(/visibility:\n\s+- exec/);
    expect(written).toContain("title: Risk Disclosure");
    expect(written).toContain("Body text.");
    expect(submitMock).toHaveBeenCalledWith("artifact-a1", expect.objectContaining({ mode: "mr" }));
    // NOT "published": the note is behind an unmerged merge request.
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
    expect(getArtifactForOwner(db, "a1", ALICE)?.publishedNotePath).toBe("docs/notes/risk.md");
  });

  it("does not fast-forward the read checkout for an mr publish (the note is not on main yet)", async () => {
    canMock.mockImplementation((_e: string, cap: string) => cap === "write");
    readyArtifact();
    await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("denies a viewer (no write capability) with 403 and never touches the write path", async () => {
    canMock.mockReturnValue(false);
    readyArtifact();
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(submitMock).not.toHaveBeenCalled();
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("ready");
  });

  it("denies a direct publish to an editor who is not an approver (403)", async () => {
    canMock.mockImplementation((_e: string, cap: string) => cap === "write");
    readyArtifact();
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "direct" });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("lets an approver publish direct, landing straight on main as published", async () => {
    canMock.mockReturnValue(true);
    submitMock.mockResolvedValue({ ok: true, branch: "main" });
    readyArtifact("a1", "docs/notes/x.md", ["all-hands"]);
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "direct" });
    expect(res).toMatchObject({ ok: true, mode: "direct", notePath: "docs/notes/x.md" });
    expect(createMergeRequestMock).not.toHaveBeenCalled();
    expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("published");
  });

  it("fast-forwards the read-serving checkout after a direct publish, so the KB view can see the note", async () => {
    // The regression: the note was pushed to main and reported published, but
    // the KB view reads a managed checkout that nothing had moved, so the note
    // 404'd and was missing from the tree and from search.
    canMock.mockReturnValue(true);
    submitMock.mockResolvedValue({ ok: true, branch: "main" });
    readyArtifact("a1", "docs/notes/x.md", ["all-hands"]);
    await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "direct" });
    expect(refreshRepoMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to publish an artifact that is not ready (409)", async () => {
    insertArtifact(db, { id: "a1", title: "Draft", ownerEmail: ALICE, body: "b" });
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign/unknown id (no existence oracle)", async () => {
    readyArtifact();
    const res = await publishArtifact(db, { id: "a1", ownerEmail: "mallory@example.com", mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 404 for a foreign owner and an unknown id IDENTICALLY (no oracle)", async () => {
    readyArtifact();
    const foreign = await publishArtifact(db, { id: "a1", ownerEmail: "mallory@example.com", mode: "mr" });
    const unknown = await publishArtifact(db, { id: "nope", ownerEmail: ALICE, mode: "mr" });
    expect(foreign).toEqual({ ok: false, status: 404, error: "artifact not found" });
    expect(unknown).toEqual(foreign);
  });

  // Force a hostile target past the ready gate by writing the column directly,
  // the way a corrupted/legacy row could carry one.
  function forceTarget(target: string) {
    insertArtifact(db, { id: "a1", title: "Bad", ownerEmail: ALICE, body: "b" });
    updateArtifact(db, "a1", ALICE, { targetPath: "docs/notes/x.md", targetVisibility: ["all-hands"], status: "ready" });
    db.prepare("UPDATE artifacts SET target_path = @t WHERE id = 'a1'").run({ t: target });
  }

  it("rejects a `..` traversal target (400) and never writes", async () => {
    forceTarget("../../etc/passwd.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("rejects an absolute target before it is ever normalized (400)", async () => {
    forceTarget("/etc/passwd.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("rejects a non-markdown target (400)", async () => {
    forceTarget("docs/notes/x.exe");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("rejects an ignored-area target (.obsidian) via the write-path ignore list (400)", async () => {
    forceTarget("docs/.obsidian/config.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("rejects a target whose parent is a symlink pointing outside the vault (400)", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-outside-"));
    fs.symlinkSync(outside, path.join(tmpRoot, "notes"));
    forceTarget("docs/notes/x.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(submitMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outside, "x.md"))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("refuses to write through a final target that is itself a symlink (400)", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-outside-"));
    fs.mkdirSync(path.join(tmpRoot, "notes"));
    fs.symlinkSync(path.join(outside, "evil.md"), path.join(tmpRoot, "notes/x.md"));
    forceTarget("docs/notes/x.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(fs.existsSync(path.join(outside, "evil.md"))).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("treats an encoded separator as a literal name (no escape): the write stays inside the vault", async () => {
    canMock.mockReturnValue(true);
    forceTarget("docs/notes/%2e%2e/%2e%2e/x.md");
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    // %2e%2e is a literal directory name, not `..`, so it resolves INSIDE the
    // vault and publishing proceeds; the note lands under tmpRoot, never above.
    expect(res).toMatchObject({ ok: true });
    expect(fs.existsSync(path.join(tmpRoot, "notes/%2e%2e/%2e%2e/x.md"))).toBe(true);
  });

  it("is a 404 when the publish flag path is off (KB write disabled)", async () => {
    delete process.env.KB_WRITE_ENABLED;
    readyArtifact();
    const res = await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  // The seam the whole `in_review` state exists for: publish opens a merge
  // request and stops, and something later has to notice the outcome. Runs the
  // real publish and the real reconciler against the real database, with only
  // GitLab and the write path faked.
  describe("the review round trip", () => {
    it("goes ready -> in_review -> published when the merge request merges", async () => {
      canMock.mockImplementation((_e: string, cap: string) => cap === "write");
      readyArtifact();

      await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
      const proposed = getArtifactForOwner(db, "a1", ALICE);
      expect(proposed?.status).toBe("in_review");
      expect(proposed?.mrIid).toBe(1);

      getMergeRequestMock.mockResolvedValue({ state: "merged" });
      const result = await reconcileInReviewArtifacts(db);

      expect(result).toMatchObject({ promoted: 1 });
      expect(getMergeRequestMock).toHaveBeenCalledWith({ iid: 1, token: "tok" });
      const published = getArtifactForOwner(db, "a1", ALICE);
      expect(published?.status).toBe("published");
      expect(published?.publishedNotePath).toBe("docs/notes/risk.md");
    });

    it("goes ready -> in_review -> ready when the merge request is closed unmerged", async () => {
      canMock.mockImplementation((_e: string, cap: string) => cap === "write");
      readyArtifact();

      await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
      getMergeRequestMock.mockResolvedValue({ state: "closed" });
      await reconcileInReviewArtifacts(db);

      const back = getArtifactForOwner(db, "a1", ALICE);
      expect(back?.status).toBe("ready");
      // Publishable again, and the next publish opens a fresh review.
      expect(back?.targetPath).toBe("docs/notes/risk.md");
      expect(back?.mrIid).toBeNull();
    });

    it("stays in review while the merge request is still open", async () => {
      canMock.mockImplementation((_e: string, cap: string) => cap === "write");
      readyArtifact();

      await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "mr" });
      getMergeRequestMock.mockResolvedValue({ state: "opened" });
      await reconcileInReviewArtifacts(db);

      expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("in_review");
    });

    it("never reconciles a direct publish, which opened no merge request", async () => {
      canMock.mockReturnValue(true);
      submitMock.mockResolvedValue({ ok: true, branch: "main" });
      readyArtifact("a1", "docs/notes/x.md", ["all-hands"]);

      await publishArtifact(db, { id: "a1", ownerEmail: ALICE, mode: "direct" });
      await reconcileInReviewArtifacts(db);

      expect(getMergeRequestMock).not.toHaveBeenCalled();
      expect(getArtifactForOwner(db, "a1", ALICE)?.status).toBe("published");
    });
  });
});
