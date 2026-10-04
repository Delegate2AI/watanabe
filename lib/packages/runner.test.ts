import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { CreateChangeRequestParams } from "@/lib/git-host";

/**
 * Real local-git integration fixture, same shape as `lib/repo-write.test.ts`:
 * a bare "remote" repo + a working checkout cloned from it (`LOCAL_REPO_PATH`)
 * + scratch worktrees/packages directories. `@/lib/repo`'s
 * `remoteUrlWithToken` is overridden to redirect the write path's push
 * destination at the local bare fixture; everything else in that module
 * (and the whole of `@/lib/repo-write`) runs for real against plain `git`.
 *
 * The SDK itself is mocked (`@anthropic-ai/claude-agent-sdk`'s `query` only —
 * `importOriginal` keeps `createSdkMcpServer`/`tool`, which
 * `buildPackagesOptions` needs to build the real `kb` MCP server, intact) so
 * each test can script exactly what the "agent" does: write a file into the
 * worktree vault (simulating a staged edit via kb_stage_edit) then yield a
 * terminal `result` message, mirroring what draining a real SDK query looks
 * like per `lib/agent/session.ts`'s `drain()`/`emitTurnResult`.
 */

let tmpRoot: string;
let bareDir: string;
let checkoutDir: string;
let worktreesDir: string;
let packagesDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeVaultFile(repoDir: string, relPath: string, content: string): void {
  const abs = path.join(repoDir, "docs", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return {
    ...actual,
    remoteUrlWithToken: () => bareDir,
  };
});

type QueryOpts = { prompt: string; options: Options };
type FakeAgent = (opts: QueryOpts) => AsyncGenerator<unknown>;

/** Swapped per-test to script exactly what the "agent" does for that scenario. */
let fakeAgent: FakeAgent = async function* () {};

const queryMock = vi.fn((opts: QueryOpts) => fakeAgent(opts));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...actual,
    query: (opts: QueryOpts) => queryMock(opts),
  };
});

const createMergeRequestMock = vi.fn(async (params: CreateChangeRequestParams) => {
  void params;
  return { webUrl: "https://gitlab.example/mr/1" };
});
vi.mock("@/lib/git-host", () => ({
  getGitHost: () => ({
    terms: { short: "MR", long: "merge request" },
    createChangeRequest: (params: CreateChangeRequestParams) => createMergeRequestMock(params),
  }),
}));

const { runPackageJob } = await import("./runner");
const { openDb } = await import("@/lib/db/client");
const { insertPackage, getPackage } = await import("@/lib/db/packages");
const { ensureWorktree, worktreePath, worktreeVaultRoot } = await import("@/lib/repo-write");
const { packageDir } = await import("./config");

type Db = ReturnType<typeof openDb>;

const ENV_KEYS = ["LOCAL_REPO_PATH", "VAULT_SUBDIR", "WORKTREE_ROOT", "PACKAGES_DATA_DIR", "REPO_WRITE_TOKEN"] as const;

let db: Db;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "packages-runner-test-"));
  bareDir = path.join(tmpRoot, "remote.git");
  checkoutDir = path.join(tmpRoot, "checkout");
  worktreesDir = path.join(tmpRoot, "worktrees");
  packagesDir = path.join(tmpRoot, "packages");

  git(tmpRoot, "init", "--bare", "-b", "main", bareDir);

  const seedDir = path.join(tmpRoot, "seed");
  git(tmpRoot, "clone", bareDir, seedDir);
  git(seedDir, "config", "user.email", "seed@example.com");
  git(seedDir, "config", "user.name", "Seed");
  writeVaultFile(seedDir, "INDEX.md", "# Index\n");
  writeVaultFile(seedDir, "00-overview/overview.md", "# Overview\n");
  git(seedDir, "add", "-A");
  git(seedDir, "commit", "-m", "initial");
  git(seedDir, "push", "origin", "main");

  git(tmpRoot, "clone", bareDir, checkoutDir);
  git(checkoutDir, "config", "user.email", "checkout@example.com");
  git(checkoutDir, "config", "user.name", "Checkout");

  for (const k of ENV_KEYS) delete process.env[k];
  process.env.LOCAL_REPO_PATH = checkoutDir;
  process.env.VAULT_SUBDIR = "docs";
  process.env.WORKTREE_ROOT = worktreesDir;
  process.env.PACKAGES_DATA_DIR = packagesDir;
  process.env.REPO_WRITE_TOKEN = "test-write-token";

  db = openDb(":memory:");
  fakeAgent = async function* () {}; // overridden per-test
  queryMock.mockClear();
  createMergeRequestMock.mockClear();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
});

/** Seed one package row plus its on-disk normalized-files directory (`packageDir(id)`). */
function seedPackage(overrides: { id: string; files?: Record<string, string>; ownerName?: string | null }) {
  const dir = packageDir(overrides.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(overrides.files ?? { "PACKAGE_CONTENTS.md": "# Contents\n" })) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  insertPackage(db, {
    id: overrides.id,
    ownerEmail: "uploader@example.com",
    ownerName: overrides.ownerName ?? "Uploader Name",
    name: "handoff-v11",
  });
  return dir;
}

const REPORT_TEXT = "# Integration report\n\nPlacement table etc.\n";

/** Scripted "agent": writes one staged file into the job's worktree vault, then yields a success result. */
function successAgent(reportText: string = REPORT_TEXT): FakeAgent {
  return async function* (opts: QueryOpts) {
    const cwd = opts.options.cwd as string;
    const target = path.join(cwd, "00-overview", "handoff-v11-notes.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# Handoff v11 notes\n\nIntegrated from the package.\n");
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 5,
      duration_api_ms: 5,
      num_turns: 1,
      stop_reason: null,
      result: reportText,
      total_cost_usd: 0.02,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      uuid: "uuid-success",
      session_id: "sdk-session-1",
    };
  };
}

/** Scripted "agent" that does no filesystem work and terminates in an error subtype. */
function errorAgent(subtype: string, errors: string[] = []): FakeAgent {
  return async function* () {
    yield {
      type: "result",
      subtype,
      is_error: true,
      duration_ms: 5,
      duration_api_ms: 5,
      num_turns: 100,
      stop_reason: null,
      total_cost_usd: 0.5,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      errors,
      uuid: "uuid-error",
      session_id: "sdk-session-1",
    };
  };
}

describe("runPackageJob — happy path", () => {
  it("archives the package, submits an MR, and marks the row submitted", async () => {
    seedPackage({ id: "pkg-happy-1" });
    fakeAgent = successAgent();

    await runPackageJob("pkg-happy-1", { db });

    const row = getPackage(db, "pkg-happy-1")!;
    expect(row.status).toBe("submitted");
    expect(row.mrUrl).toBe("https://gitlab.example/mr/1");
    expect(row.report).toBe(REPORT_TEXT);
    expect(row.threadId).toBe("pkg-pkg-happy-1");

    expect(createMergeRequestMock).toHaveBeenCalledTimes(1);
    const [mrArgs] = createMergeRequestMock.mock.calls[0];
    expect(mrArgs.description).toBe(REPORT_TEXT);
    expect(mrArgs.title).toBe("Integrate update package: handoff-v11");
    expect(typeof mrArgs.sourceBranch).toBe("string");

    const branch = mrArgs.sourceBranch as string;
    expect(branch).toMatch(/^kb\/uploader-example-com\/handoff-v11-\d+$/);

    // The archive copy and the agent's own staged edit both landed on the pushed branch.
    const archived = git(
      bareDir,
      "show",
      `${branch}:docs/99-reference/handoffs/handoff-v11/PACKAGE_CONTENTS.md`,
    );
    expect(archived).toBe("# Contents");
    const agentEdit = git(bareDir, "show", `${branch}:docs/00-overview/handoff-v11-notes.md`);
    expect(agentEdit).toContain("Integrated from the package.");

    // main is untouched — package runs are always MR, never a direct push.
    expect(() => git(bareDir, "show", "main:docs/00-overview/handoff-v11-notes.md")).toThrow();

    // submit() removes the worktree on success.
    expect(fs.existsSync(worktreePath("pkg-pkg-happy-1"))).toBe(false);
  });

  it("never invokes the agent when REPO_WRITE_TOKEN is unset (fail-fast)", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    seedPackage({ id: "pkg-no-token" });
    fakeAgent = successAgent();

    await runPackageJob("pkg-no-token", { db });

    expect(queryMock).not.toHaveBeenCalled();
    const row = getPackage(db, "pkg-no-token")!;
    expect(row.status).toBe("failed");
    // A reason code, not the environment variable name: this string is
    // rendered to a contributor who has never seen the repo.
    expect(row.error).toBe("write_unavailable");
  });
});

describe("runPackageJob: boot-requeued crash recovery", () => {
  it("discards a pre-existing (crashed-run) worktree before running, so a stray file left behind never rides along on the pushed branch", async () => {
    seedPackage({ id: "pkg-dirty-1" });
    fakeAgent = successAgent();

    // Simulate the crash scenario Fix 1 targets: a previous run for this
    // exact thread id got as far as creating (and registering) the worktree
    // and staging a stray file in it, then the process died before
    // `submit`/`discard` ever ran; `bootPackages` will requeue the row, but
    // the worktree itself survives untouched (`sweepOrphanWorktrees` only
    // removes UNregistered dirs, and `ensureWorktree` reuses a registered
    // one).
    const threadId = "pkg-pkg-dirty-1";
    await ensureWorktree(threadId);
    const strayPath = path.join(worktreeVaultRoot(threadId), "00-overview", "stray-from-crashed-run.md");
    fs.mkdirSync(path.dirname(strayPath), { recursive: true });
    fs.writeFileSync(strayPath, "# Leftover from a crashed run\n");

    await runPackageJob("pkg-dirty-1", { db });

    const row = getPackage(db, "pkg-dirty-1")!;
    expect(row.status).toBe("submitted");

    const [mrArgs] = createMergeRequestMock.mock.calls[0];
    const branch = mrArgs.sourceBranch as string;

    // The stray file from the crashed run must NOT be on the pushed branch.
    expect(() => git(bareDir, "show", `${branch}:docs/00-overview/stray-from-crashed-run.md`)).toThrow();
    // The happy-path work (archive copy + this run's own agent edit) still landed.
    const agentEdit = git(bareDir, "show", `${branch}:docs/00-overview/handoff-v11-notes.md`);
    expect(agentEdit).toContain("Integrated from the package.");
  });
});

describe("runPackageJob — agent error", () => {
  it("an error-subtype result marks the row failed and preserves the worktree", async () => {
    seedPackage({ id: "pkg-error-1" });
    fakeAgent = errorAgent("error_max_turns", ["turn budget exceeded"]);

    await runPackageJob("pkg-error-1", { db });

    const row = getPackage(db, "pkg-error-1")!;
    expect(row.status).toBe("failed");
    expect(row.error).toContain("turn budget exceeded");
    expect(row.mrUrl).toBeNull();
    expect(createMergeRequestMock).not.toHaveBeenCalled();

    // Worktree survives so the uploader can inspect it in the draft view.
    expect(fs.existsSync(worktreePath("pkg-pkg-error-1"))).toBe(true);
    // The archive copy still happened before the agent ran.
    expect(
      fs.existsSync(
        path.join(worktreeVaultRoot("pkg-pkg-error-1"), "99-reference", "handoffs", "handoff-v11", "PACKAGE_CONTENTS.md"),
      ),
    ).toBe(true);
  });

  it("a spawn/auth failure (query() throws) is caught and marks the row failed", async () => {
    seedPackage({ id: "pkg-throw-1" });
    fakeAgent = async function* () {
      throw new Error("failed to spawn claude CLI subprocess");
    };

    await runPackageJob("pkg-throw-1", { db });

    const row = getPackage(db, "pkg-throw-1")!;
    expect(row.status).toBe("failed");
    expect(row.error).toContain("failed to spawn claude CLI subprocess");
  });
});

describe("runPackageJob — empty diff edge", () => {
  it("an empty package (archive copy produces nothing staged) resolves to no_changes and discards the worktree", async () => {
    // An empty package directory: fs.cp of an empty dir creates an empty
    // archive directory, which git never tracks — the diff stays empty even
    // though the copy "succeeded".
    seedPackage({ id: "pkg-empty-1", files: {} });
    fakeAgent = async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        stop_reason: null,
        result: "Nothing to integrate.",
        total_cost_usd: 0.001,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: "uuid-empty",
        session_id: "sdk-session-1",
      };
    };

    await runPackageJob("pkg-empty-1", { db });

    const row = getPackage(db, "pkg-empty-1")!;
    expect(row.status).toBe("no_changes");
    expect(row.report).toBe("Nothing to integrate.");
    expect(createMergeRequestMock).not.toHaveBeenCalled();
    expect(fs.existsSync(worktreePath("pkg-pkg-empty-1"))).toBe(false);
  });
});

describe("runPackageJob — bail conditions", () => {
  it("does nothing for an unknown package id", async () => {
    await expect(runPackageJob("does-not-exist", { db })).resolves.toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("does nothing for a package that isn't queued", async () => {
    seedPackage({ id: "pkg-already-done" });
    // Run it once to move it out of `queued` (fail-fast, no token needed).
    delete process.env.REPO_WRITE_TOKEN;
    await runPackageJob("pkg-already-done", { db });
    expect(getPackage(db, "pkg-already-done")!.status).toBe("failed");

    process.env.REPO_WRITE_TOKEN = "test-write-token";
    queryMock.mockClear();
    await runPackageJob("pkg-already-done", { db });
    expect(queryMock).not.toHaveBeenCalled();
    expect(getPackage(db, "pkg-already-done")!.status).toBe("failed"); // unchanged
  });
});
