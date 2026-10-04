import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { CreateChangeRequestParams } from "@/lib/git-host";

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
  return { ...actual, remoteUrlWithToken: () => bareDir };
});

type QueryOpts = { prompt: string; options: Options };
type FakeAgent = (opts: QueryOpts) => AsyncGenerator<unknown>;

let fakeAgent: FakeAgent = async function* () {};
const queryMock = vi.fn((opts: QueryOpts) => fakeAgent(opts));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return { ...actual, query: (opts: QueryOpts) => queryMock(opts) };
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

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { runPackageJob } = await import("./runner");
const { openDb } = await import("@/lib/db/client");
const { insertPackage, getPackage } = await import("@/lib/db/packages");
const { listUsageRows } = await import("@/lib/db/usage-queries");
const { packageDir } = await import("./config");

const PERIOD = { from: "2020-01-01", to: "2099-12-31" };
const ENV_KEYS = ["LOCAL_REPO_PATH", "VAULT_SUBDIR", "WORKTREE_ROOT", "PACKAGES_DATA_DIR", "REPO_WRITE_TOKEN"] as const;
const REPORT_TEXT = "# Integration report\n\nPlacement table etc.\n";

function successAgent(): FakeAgent {
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
      result: REPORT_TEXT,
      total_cost_usd: 0.02,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: {
        "claude-opus-4-8": {
          inputTokens: 4000,
          outputTokens: 800,
          cacheReadInputTokens: 120,
          cacheCreationInputTokens: 60,
          webSearchRequests: 0,
          costUSD: 0.02,
          contextWindow: 200000,
          maxOutputTokens: 64000,
        },
      },
      permission_denials: [],
      uuid: "packages-result-1",
      session_id: "sdk-session-1",
    };
  };
}

function seedPackage(id: string): void {
  const dir = packageDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "PACKAGE_CONTENTS.md"), "# Contents\n");
  insertPackage(db, {
    id,
    ownerEmail: "uploader@example.com",
    ownerName: "Uploader Name",
    name: "handoff-v11",
  });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "packages-runner-usage-test-"));
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

  for (const key of ENV_KEYS) delete process.env[key];
  process.env.LOCAL_REPO_PATH = checkoutDir;
  process.env.VAULT_SUBDIR = "docs";
  process.env.WORKTREE_ROOT = worktreesDir;
  process.env.PACKAGES_DATA_DIR = packagesDir;
  process.env.REPO_WRITE_TOKEN = "test-write-token";
  process.env.USAGE_AUDIT_ENABLED = "1";

  db = openDb(":memory:");
  fakeAgent = successAgent();
  queryMock.mockClear();
  createMergeRequestMock.mockClear();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const key of ENV_KEYS) delete process.env[key];
  delete process.env.USAGE_AUDIT_ENABLED;
});

describe("package runner usage capture", () => {
  it("records the job as system spend under the packages source", async () => {
    seedPackage("pkg-usage-1");

    await runPackageJob("pkg-usage-1", { db });

    expect(getPackage(db, "pkg-usage-1")?.status).toBe("submitted");
    const rows = listUsageRows(db, PERIOD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "packages",
      ownerEmail: null,
      threadId: null,
      model: "claude-opus-4-8",
      inputTokens: 4000,
      cacheReadTokens: 120,
      costUsd: 0.02,
      ok: true,
    });
  });

  it("writes nothing with the audit flag off", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";
    seedPackage("pkg-usage-2");

    await runPackageJob("pkg-usage-2", { db });

    expect(listUsageRows(db, PERIOD)).toEqual([]);
  });
});
