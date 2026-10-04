import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * `kb_submit`'s integrity-checker escalation path (spec: kb-integrity-check),
 * split into its own file rather than added to `write-tools.test.ts` because
 * that file is already at this repo's 300-line soft-warn ceiling and these
 * tests need their own module-level mocks for `@/lib/quality/config` and
 * `@/lib/quality/agents`, same rationale as `write-tools.quality.test.ts`'s
 * split: each test file sets up its own self-contained mocks rather than
 * sharing helpers across files.
 */

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

const isIntegrityEnabledMock = vi.fn(() => false);
const runIntegrityCheckerMock = vi.fn(async () => [] as { agent: string; severity: string; message: string }[]);
vi.mock("@/lib/quality/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/quality/config")>();
  return { ...actual, isIntegrityEnabled: () => isIntegrityEnabledMock() };
});
vi.mock("@/lib/quality/agents", () => ({
  runIntegrityChecker: (...args: [string, string?]) => runIntegrityCheckerMock(...args),
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
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-tools-integrity-test-"));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.REPO_WRITE_TOKEN = "glpat-test-token";
  ensureWorktreeMock.mockClear();
  worktreeVaultRootMock.mockClear();
  diffMock.mockClear();
  discardMock.mockClear();
  submitMock.mockClear();
  refreshRepoMock.mockClear();
  createMergeRequestMock.mockClear();
  isIntegrityEnabledMock.mockReset();
  isIntegrityEnabledMock.mockReturnValue(false);
  runIntegrityCheckerMock.mockReset();
  runIntegrityCheckerMock.mockResolvedValue([]);
});

afterEach(() => {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("kb_submit: integrity-check escalation", () => {
  beforeEach(() => {
    isIntegrityEnabledMock.mockReturnValue(true);
    runIntegrityCheckerMock.mockReset();
    runIntegrityCheckerMock.mockResolvedValue([]);
    process.env.ROLES_ENABLED = "1";
    process.env.KB_WRITE_MODE = "direct";
    process.env.MEMORY_CHECKOUT_DIR = vaultDir;
    fs.mkdirSync(path.join(vaultDir, "access"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, "access", "roles.yaml"),
      "roles:\n  approver: [approver@example.com]\ndefault: viewer\n",
    );
  });

  it("forces mr mode for an approver's direct submission when integrity-checker flags a finding", async () => {
    runIntegrityCheckerMock.mockResolvedValue([
      { agent: "integrity-checker", severity: "warn", message: "Duplicates docs/a.md." },
    ]);
    submitMock.mockResolvedValueOnce({ ok: true, branch: "kb/approver/ok-slug-123" });

    const result = await tools({ ...context, ownerEmail: "approver@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );

    expect(isError(result)).toBe(false);
    expect(refreshRepoMock).not.toHaveBeenCalled();
    expect(createMergeRequestMock).toHaveBeenCalled();
    expect(submitMock).toHaveBeenCalledWith("thread-1", expect.objectContaining({ mode: "mr" }));
    expect(text(result)).toContain("flagged for review");
    // The finding itself, not just that there was one: this text is the only
    // place a contributor's own MCP client ever sees what conflicted.
    expect(text(result)).toContain("Duplicates docs/a.md.");
  });

  it("still direct-commits for an approver when integrity-checker finds nothing", async () => {
    submitMock.mockResolvedValueOnce({ ok: true, branch: "main" });

    const result = await tools({ ...context, ownerEmail: "approver@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );

    expect(isError(result)).toBe(false);
    expect(refreshRepoMock).toHaveBeenCalledTimes(1);
    expect(createMergeRequestMock).not.toHaveBeenCalled();
    expect(submitMock).toHaveBeenCalledWith("thread-1", expect.objectContaining({ mode: "direct" }));
  });

  it("never widens access: an editor on a direct-only deployment is still denied, even with a finding", async () => {
    fs.writeFileSync(
      path.join(vaultDir, "access", "roles.yaml"),
      "roles:\n  editor: [editor@example.com]\ndefault: viewer\n",
    );
    runIntegrityCheckerMock.mockResolvedValue([
      { agent: "integrity-checker", severity: "warn", message: "Duplicates docs/a.md." },
    ]);

    const result = await tools({ ...context, ownerEmail: "editor@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );

    expect(isError(result)).toBe(true);
    expect(text(result)).toContain("approver");
    expect(submitMock).not.toHaveBeenCalled();
    expect(runIntegrityCheckerMock).not.toHaveBeenCalled();
  });

  it("flag off: kb_submit behaves exactly as before, integrity-checker never invoked", async () => {
    isIntegrityEnabledMock.mockReturnValue(false);
    submitMock.mockResolvedValueOnce({ ok: true, branch: "main" });

    const result = await tools({ ...context, ownerEmail: "approver@example.com" }).kb_submit.handler(
      { message: "m", slug: "ok-slug" },
      {},
    );

    expect(isError(result)).toBe(false);
    expect(refreshRepoMock).toHaveBeenCalledTimes(1);
    expect(runIntegrityCheckerMock).not.toHaveBeenCalled();
  });
});
