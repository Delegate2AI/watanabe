import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The write path and GitLab are mocked; containment, the on-disk removal and
// the refusal mapping all run for real, so these tests exercise the actual
// staging orchestration rather than its branching.
const ensureWorktreeMock = vi.fn();
const worktreeExistsMock = vi.fn(() => false);
const submitMock = vi.fn();
const discardMock = vi.fn();
let vaultRoot: string;
vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...a: unknown[]) => ensureWorktreeMock(...a),
  worktreeExists: () => worktreeExistsMock(),
  worktreeVaultRoot: () => vaultRoot,
  submit: (...a: unknown[]) => submitMock(...a),
  discard: (...a: unknown[]) => discardMock(...a),
}));

const createMergeRequestMock = vi.fn();
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (...a: unknown[]) => createMergeRequestMock(...a),
  }),
}));

const { proposeNoteDeletion } = await import("./delete-note");

const ADMIN = "boss@example.com";
let tmpRoot: string;

function note(rel: string, body = "# Risk\n\nBody.\n"): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return abs;
}

beforeEach(() => {
  process.env.REPO_WRITE_TOKEN = "tok";
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-delete-"));
  vaultRoot = tmpRoot;
  ensureWorktreeMock.mockReset().mockResolvedValue(tmpRoot);
  worktreeExistsMock.mockReset().mockReturnValue(false);
  submitMock.mockReset().mockResolvedValue({ ok: true, branch: "kb/boss/delete-risk-1" });
  discardMock.mockReset().mockResolvedValue(undefined);
  createMergeRequestMock.mockReset().mockResolvedValue({ webUrl: "https://gl/mr/9", iid: 9 });
});

afterEach(() => {
  delete process.env.REPO_WRITE_TOKEN;
  delete process.env.KB_WRITE_MODE;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("proposeNoteDeletion", () => {
  it("refuses a path that escapes the vault", async () => {
    expect(
      await proposeNoteDeletion({ relPath: "../access/roles.yaml", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(submitMock).not.toHaveBeenCalled();
    expect(discardMock).toHaveBeenCalledWith(expect.stringMatching(/^delete-/));
  });

  it("refuses a path inside an ignored area of the vault", async () => {
    note(".obsidian/workspace.json", "{}");
    expect(
      await proposeNoteDeletion({ relPath: ".obsidian/workspace.json", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  // "Writable by nobody" has to mean every write path, not only the MCP tools.
  it("refuses a note inside a system-owned folder", async () => {
    note("meetings/2026-08-01-standup.md", "# Standup\n");
    expect(
      await proposeNoteDeletion({ relPath: "meetings/2026-08-01-standup.md", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("refuses to act through a symlink", async () => {
    const outside = path.join(tmpRoot, "..", `outside-${path.basename(tmpRoot)}.md`);
    fs.writeFileSync(outside, "secret", "utf8");
    fs.symlinkSync(outside, path.join(tmpRoot, "link.md"));
    try {
      expect(
        await proposeNoteDeletion({ relPath: "link.md", actorEmail: ADMIN, actorName: "Boss" }),
      ).toMatchObject({ ok: false, reason: "forbidden" });
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses a path that does not exist in the vault", async () => {
    expect(
      await proposeNoteDeletion({ relPath: "exec/missing.md", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("refuses a directory", async () => {
    note("exec/comp.md");
    expect(
      await proposeNoteDeletion({ relPath: "exec", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("reports write_unavailable with no write credential configured", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    note("exec/comp.md");
    expect(
      await proposeNoteDeletion({ relPath: "exec/comp.md", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "write_unavailable" });
    expect(ensureWorktreeMock).not.toHaveBeenCalled();
  });

  it("discards a stale worktree before staging this removal", async () => {
    worktreeExistsMock.mockReturnValue(true);
    note("exec/comp.md");
    await proposeNoteDeletion({ relPath: "exec/comp.md", actorEmail: ADMIN, actorName: "Boss" });
    expect(discardMock.mock.invocationCallOrder[0]).toBeLessThan(ensureWorktreeMock.mock.invocationCallOrder[0]);
  });

  it("stages the removal, commits it as the actor, and opens a merge request", async () => {
    const abs = note("exec/comp.md");
    const result = await proposeNoteDeletion({
      relPath: "docs/exec/comp.md",
      actorEmail: ADMIN,
      actorName: "Boss Person",
    });

    expect(fs.existsSync(abs)).toBe(false);
    expect(submitMock).toHaveBeenCalledWith(
      expect.stringMatching(/^delete-/),
      expect.objectContaining({ authorName: "Boss Person", authorEmail: ADMIN, writeToken: "tok" }),
    );
    expect(createMergeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBranch: "kb/boss/delete-risk-1",
        title: "Delete docs/exec/comp.md",
        token: "tok",
      }),
    );
    expect(String(createMergeRequestMock.mock.calls[0][0].description)).toContain("Boss Person");
    expect(result).toEqual({ ok: true, branch: "kb/boss/delete-risk-1", mrUrl: "https://gl/mr/9" });
  });

  it("neutralizes a GitLab quick action carried in the actor's own name", async () => {
    note("exec/comp.md");
    await proposeNoteDeletion({
      relPath: "exec/comp.md",
      actorEmail: ADMIN,
      actorName: "Boss\n/merge",
    });
    expect(String(createMergeRequestMock.mock.calls[0][0].description)).toContain("\\/merge");
  });

  it("submits in mr mode even where the deployment is configured for direct", async () => {
    process.env.KB_WRITE_MODE = "direct";
    note("exec/comp.md");
    await proposeNoteDeletion({ relPath: "exec/comp.md", actorEmail: ADMIN, actorName: "Boss" });
    expect(submitMock.mock.calls[0][1]).toMatchObject({ mode: "mr" });
  });

  it("reports a conflict without discarding anything", async () => {
    submitMock.mockResolvedValue({ ok: false, conflict: true, files: ["exec/comp.md"] });
    note("exec/comp.md");
    const result = await proposeNoteDeletion({ relPath: "exec/comp.md", actorEmail: ADMIN, actorName: "Boss" });
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("reports failed when the merge request cannot be opened", async () => {
    createMergeRequestMock.mockRejectedValue(new Error("gitlab down"));
    note("exec/comp.md");
    expect(
      await proposeNoteDeletion({ relPath: "exec/comp.md", actorEmail: ADMIN, actorName: "Boss" }),
    ).toMatchObject({ ok: false, reason: "failed" });
  });
});
