import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Unit-tested WITHOUT real git: `ensureWorktree`/`diff`/`discard`/`submit`
// (lib/repo-write.ts) and `createMergeRequest` (lib/gitlab.ts) are mocked, so
// these tests exercise write-tools.ts's own logic — path containment,
// extension rejection, slug sanitization, and result-shape handling — against
// a plain temp directory standing in for a worktree's vault root. The real
// git behavior (worktree lifecycle, commit, rebase, push) is covered by
// lib/repo-write.test.ts's integration suite instead.

let vaultDir: string;

const ensureWorktreeMock = vi.fn(async () => "/fake/worktree");
const worktreeVaultRootMock = vi.fn(() => vaultDir);
const diffMock = vi.fn(async () => "");
const discardMock = vi.fn(async () => {});
const submitMock = vi.fn(async () => ({ ok: true as const, branch: "main" }));

vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...args: unknown[]) => ensureWorktreeMock(...args),
  worktreeVaultRoot: (...args: unknown[]) => worktreeVaultRootMock(...args),
  diff: (...args: unknown[]) => diffMock(...args),
  discard: (...args: unknown[]) => discardMock(...args),
  submit: (...args: unknown[]) => submitMock(...args),
}));

const refreshRepoMock = vi.fn(async () => {});
vi.mock("@/lib/repo", () => ({
  refreshRepo: (...args: unknown[]) => refreshRepoMock(...args),
}));

const createMergeRequestMock = vi.fn(async () => ({ webUrl: "https://gitlab.com/mr/1" }));
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (...args: unknown[]) => createMergeRequestMock(...args),
  }),
}));

const { createWriteTools } = await import("./write-tools");

const context = { getThreadId: () => "thread-1", ownerEmail: "alice@example.com", ownerName: "Alice Contributor" };

function tools(toolContext = context) {
  const list = createWriteTools(toolContext);
  return Object.fromEntries(list.map((t) => [t.name, t]));
}

function isError(result: CallToolResult): boolean {
  return result.isError === true;
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

const ENV_KEYS = ["KB_WRITE_MODE", "REPO_WRITE_TOKEN", "ROLES_ENABLED", "MEMORY_CHECKOUT_DIR"] as const;

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-tools-test-"));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.REPO_WRITE_TOKEN = "glpat-test-token";
  ensureWorktreeMock.mockClear();
  worktreeVaultRootMock.mockClear();
  diffMock.mockClear();
  discardMock.mockClear();
  submitMock.mockClear();
  refreshRepoMock.mockClear();
  createMergeRequestMock.mockClear();
});

afterEach(() => {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("kb_stage_edit", () => {
  it("writes the file inside the worktree vault, creating parent dirs", async () => {
    const result = await tools().kb_stage_edit.handler({ path: "sub/new-page.md", new_content: "# Hi\n" }, {});
    expect(isError(result)).toBe(false);
    expect(fs.readFileSync(path.join(vaultDir, "sub/new-page.md"), "utf8")).toBe("# Hi\n");
  });

  it("rejects a known-binary extension without touching the filesystem", async () => {
    const result = await tools().kb_stage_edit.handler({ path: "image.png", new_content: "not really an image" }, {});
    expect(isError(result)).toBe(true);
    expect(fs.existsSync(path.join(vaultDir, "image.png"))).toBe(false);
  });

  it("rejects a path that escapes the vault root", async () => {
    const result = await tools().kb_stage_edit.handler({ path: "../../etc/passwd", new_content: "pwned" }, {});
    expect(isError(result)).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(vaultDir), "etc", "passwd"))).toBe(false);
  });

  it("calls ensureWorktree for the context's thread id", async () => {
    await tools().kb_stage_edit.handler({ path: "a.md", new_content: "x" }, {});
    expect(ensureWorktreeMock).toHaveBeenCalledWith("thread-1");
  });
});

describe("kb_stage_delete", () => {
  it("deletes an existing file", async () => {
    fs.writeFileSync(path.join(vaultDir, "gone.md"), "bye");
    const result = await tools().kb_stage_delete.handler({ path: "gone.md" }, {});
    expect(isError(result)).toBe(false);
    expect(fs.existsSync(path.join(vaultDir, "gone.md"))).toBe(false);
  });

  it("returns an error for a nonexistent file instead of throwing", async () => {
    const result = await tools().kb_stage_delete.handler({ path: "never-existed.md" }, {});
    expect(isError(result)).toBe(true);
  });

  it("rejects a path that escapes the vault root", async () => {
    const result = await tools().kb_stage_delete.handler({ path: "../outside.md" }, {});
    expect(isError(result)).toBe(true);
  });
});

describe("kb_diff", () => {
  it("reports '(nothing staged yet)' when the diff is empty", async () => {
    diffMock.mockResolvedValueOnce("");
    const result = await tools().kb_diff.handler({}, {});
    expect(text(result)).toContain("nothing staged");
  });

  it("returns the raw diff text otherwise", async () => {
    diffMock.mockResolvedValueOnce("diff --git a/docs/x.md b/docs/x.md\n...");
    const result = await tools().kb_diff.handler({}, {});
    expect(text(result)).toContain("diff --git");
  });
});

describe("kb_discard", () => {
  it("calls discard for the context's thread id and confirms", async () => {
    const result = await tools().kb_discard.handler({}, {});
    expect(discardMock).toHaveBeenCalledWith("thread-1");
    expect(isError(result)).toBe(false);
  });
});

describe("kb_submit", () => {
  it("rejects an invalid slug without calling submit at all", async () => {
    const result = await tools().kb_submit.handler({ message: "m", slug: "Not Valid!" }, {});
    expect(isError(result)).toBe(true);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("errors clearly when no write token is configured, without calling submit", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(true);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("passes the owner's name/email as commit author and the configured token", async () => {
    await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(submitMock).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        message: "m",
        slug: "ok-slug",
        authorName: "Alice Contributor",
        authorEmail: "alice@example.com",
        writeToken: "glpat-test-token",
      }),
    );
  });

  it("reports a conflict clearly and does not attempt an MR/refresh", async () => {
    submitMock.mockResolvedValueOnce({ ok: false, conflict: true, files: ["docs/overview.md"] });
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("docs/overview.md");
    expect(createMergeRequestMock).not.toHaveBeenCalled();
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("reports a plain submit error", async () => {
    submitMock.mockResolvedValueOnce({ ok: false, error: "nothing staged" });
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("nothing staged");
  });

  it("direct mode: refreshes the read-serving checkout and does not open an MR", async () => {
    process.env.KB_WRITE_MODE = "direct";
    submitMock.mockResolvedValueOnce({ ok: true, branch: "main" });
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(false);
    expect(refreshRepoMock).toHaveBeenCalledTimes(1);
    expect(createMergeRequestMock).not.toHaveBeenCalled();
  });

  it("mr mode (default): opens a Merge Request and returns its URL", async () => {
    submitMock.mockResolvedValueOnce({ ok: true, branch: "kb/alice/ok-slug-123" });
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(false);
    expect(createMergeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBranch: "kb/alice/ok-slug-123", token: "glpat-test-token" }),
    );
    expect(text(result)).toContain("https://gitlab.com/mr/1");
    expect(refreshRepoMock).not.toHaveBeenCalled();
  });

  it("mr mode: a failed MR creation still reports the branch was pushed, not a hard failure", async () => {
    submitMock.mockResolvedValueOnce({ ok: true, branch: "kb/alice/ok-slug-123" });
    createMergeRequestMock.mockRejectedValueOnce(new Error("GitLab API returned 403"));
    const result = await tools().kb_submit.handler({ message: "m", slug: "ok-slug" }, {});
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("kb/alice/ok-slug-123");
    expect(text(result)).toContain("403");
  });

  it("allows an editor to submit in mr mode", async () => {
    process.env.ROLES_ENABLED = "1";
    process.env.MEMORY_CHECKOUT_DIR = vaultDir;
    fs.mkdirSync(path.join(vaultDir, "access"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, "access", "roles.yaml"),
      "roles:\n  editor: [editor@example.com]\ndefault: viewer\n",
    );

    const result = await tools({ ...context, ownerEmail: "editor@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );
    expect(isError(result)).toBe(false);
    expect(submitMock).toHaveBeenCalled();
  });

  it("rejects direct mode for an editor before submitting", async () => {
    process.env.ROLES_ENABLED = "1";
    process.env.KB_WRITE_MODE = "direct";
    process.env.MEMORY_CHECKOUT_DIR = vaultDir;
    fs.mkdirSync(path.join(vaultDir, "access"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, "access", "roles.yaml"),
      "roles:\n  editor: [editor@example.com]\ndefault: viewer\n",
    );

    const result = await tools({ ...context, ownerEmail: "editor@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );
    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("approver");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("allows an approver to submit in direct mode", async () => {
    process.env.ROLES_ENABLED = "1";
    process.env.KB_WRITE_MODE = "direct";
    process.env.MEMORY_CHECKOUT_DIR = vaultDir;
    fs.mkdirSync(path.join(vaultDir, "access"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, "access", "roles.yaml"),
      "roles:\n  approver: [approver@example.com]\ndefault: viewer\n",
    );

    const result = await tools({ ...context, ownerEmail: "approver@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );
    expect(isError(result)).toBe(false);
    expect(submitMock).toHaveBeenCalled();
  });
});
