import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureWorktreeMock = vi.fn();
const submitMock = vi.fn();
const discardMock = vi.fn();
const createMergeRequestMock = vi.fn();
let worktreeRoot: string;
vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...args: unknown[]) => ensureWorktreeMock(...args),
  submit: (...args: unknown[]) => submitMock(...args),
  discard: (...args: unknown[]) => discardMock(...args),
  worktreeVaultRoot: () => worktreeRoot,
}));
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (...args: unknown[]) => createMergeRequestMock(...args),
  }),
}));

import { reclearMeeting } from "./reclearance";

describe("reclearMeeting", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "reclearance-"));
    worktreeRoot = path.join(root, "docs");
    mkdirSync(path.join(root, "access"), { recursive: true });
    mkdirSync(path.join(worktreeRoot, "meetings"), { recursive: true });
    writeFileSync(path.join(root, "access", "groups.yaml"), "groups:\n  admins: [admin@example.com]\n  exec: [member@example.com]\n");
    writeFileSync(path.join(root, "access", "roles.yaml"), "roles:\n  admin: [admin@example.com]\ndefault: viewer\n");
    writeFileSync(
      path.join(worktreeRoot, "meetings", "one.md"),
      "---\ntitle: One\ntype: meeting\nvisibility:\n  - admins\n---\n\nTranscript\n",
    );
    process.env.AUTHORITY_ENABLED = "1";
    process.env.ROLES_ENABLED = "1";
    process.env.REPO_WRITE_TOKEN = "test-token";
    ensureWorktreeMock.mockReset().mockResolvedValue(root);
    submitMock.mockReset().mockResolvedValue({ ok: true, branch: "kb/admin/reclear-1" });
    discardMock.mockReset().mockResolvedValue(undefined);
    createMergeRequestMock.mockReset().mockResolvedValue({ webUrl: "https://git.example.com/mr/7", iid: 7 });
  });

  afterEach(() => {
    delete process.env.AUTHORITY_ENABLED;
    delete process.env.ROLES_ENABLED;
    delete process.env.REPO_WRITE_TOKEN;
    rmSync(root, { recursive: true, force: true });
  });

  it("rewrites only visibility and submits a review branch as the admin", async () => {
    const result = await reclearMeeting("docs/meetings/one.md", ["exec"], "admin@example.com", { accessRoot: root });

    expect(result).toEqual({ ok: true, branch: "kb/admin/reclear-1", mrUrl: "https://git.example.com/mr/7" });
    const content = readFileSync(path.join(worktreeRoot, "meetings", "one.md"), "utf8");
    expect(content).toContain("visibility:\n  - exec");
    expect(content).toContain("Transcript");
    expect(submitMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ authorEmail: "admin@example.com", mode: "mr" }),
    );
  });

  it("opens a merge request against the pushed branch, since a branch alone is not reviewable", async () => {
    await reclearMeeting("docs/meetings/one.md", ["exec", "admins"], "admin@example.com", { accessRoot: root });

    expect(createMergeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBranch: "kb/admin/reclear-1",
        title: "fix(meeting): re-clear one.md",
        token: "test-token",
      }),
    );
    const { description } = createMergeRequestMock.mock.calls[0][0] as { description: string };
    expect(description).toContain("docs/meetings/one.md");
    expect(description).toContain("admins, exec");
    expect(description).toContain("admin@example.com");
  });

  it("reports the merge request failure without losing the pushed branch", async () => {
    createMergeRequestMock.mockRejectedValue(new Error("GitLab merge_requests API returned 403"));

    const result = await reclearMeeting("docs/meetings/one.md", ["exec"], "admin@example.com", { accessRoot: root });

    // Not a generic refusal: the branch is on the remote, so a retry would only
    // push a second one and the caller needs to be told the difference.
    expect(result).toEqual({ ok: false, error: "review_unavailable", branch: "kb/admin/reclear-1" });
  });

  it("denies a non-admin before checking whether the note exists", async () => {
    const existing = await reclearMeeting("docs/meetings/one.md", ["exec"], "member@example.com", { accessRoot: root });
    const absent = await reclearMeeting("docs/meetings/missing.md", ["exec"], "member@example.com", { accessRoot: root });

    expect(existing).toEqual(absent);
    expect(existing).toEqual({ ok: false, error: "forbidden" });
    expect(ensureWorktreeMock).not.toHaveBeenCalled();
  });

  it("fails closed for unknown or empty visibility without touching the note", async () => {
    const before = readFileSync(path.join(worktreeRoot, "meetings", "one.md"), "utf8");

    expect((await reclearMeeting("docs/meetings/one.md", [], "admin@example.com", { accessRoot: root })).ok).toBe(false);
    expect((await reclearMeeting("docs/meetings/one.md", ["unknown"], "admin@example.com", { accessRoot: root })).ok).toBe(false);
    expect(readFileSync(path.join(worktreeRoot, "meetings", "one.md"), "utf8")).toBe(before);
    expect(ensureWorktreeMock).not.toHaveBeenCalled();
  });
});
