import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/lib/config";

let tmpRoot: string;
let bareDir: string;
let checkoutDir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

vi.mock("@/lib/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/repo")>();
  return { ...actual, remoteUrlWithToken: () => bareDir };
});

const { commitPrivateAccess } = await import("./repo-write-private-access");

const ENV_KEYS = [
  "LOCAL_REPO_PATH",
  "VAULT_SUBDIR",
  "WORKTREE_ROOT",
  "MEMORY_ORIGIN_OVERRIDE",
  "MEMORY_CHECKOUT_DIR",
  "BOOTSTRAP_ADMINS",
] as const;

const BOT = getConfig().git.botEmail;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "private-access-test-"));
  bareDir = path.join(tmpRoot, "remote.git");
  checkoutDir = path.join(tmpRoot, "checkout");

  git(tmpRoot, "init", "--bare", "-b", "main", bareDir);
  const seedDir = path.join(tmpRoot, "seed");
  git(tmpRoot, "clone", bareDir, seedDir);
  git(seedDir, "config", "user.email", "seed@example.com");
  git(seedDir, "config", "user.name", "Seed");
  fs.writeFileSync(path.join(seedDir, "README.md"), "# seed\n");
  git(seedDir, "add", "-A");
  git(seedDir, "commit", "-m", "initial");
  git(seedDir, "push", "origin", "main");
  git(tmpRoot, "clone", bareDir, checkoutDir);

  for (const key of ENV_KEYS) delete process.env[key];
  process.env.LOCAL_REPO_PATH = checkoutDir;
  process.env.VAULT_SUBDIR = "docs";
  process.env.WORKTREE_ROOT = path.join(tmpRoot, "worktrees");
  process.env.MEMORY_ORIGIN_OVERRIDE = bareDir;
  process.env.MEMORY_CHECKOUT_DIR = path.join(tmpRoot, "memory");
  process.env.BOOTSTRAP_ADMINS = `admin@example.com,${BOT}`;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("commitPrivateAccess attribution", () => {
  it("records the named human as the git author and the bot as the committer", async () => {
    const result = await commitPrivateAccess(
      { "access/skills.yaml": "skills: {}\n" },
      {
        message: "chore(access): add skill release-notes",
        authorName: BOT,
        authorEmail: BOT,
        onBehalfOf: { name: "alice@example.com", email: "alice@example.com" },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(git(bareDir, "log", "portal-memory", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe(
      `alice@example.com <alice@example.com>|${getConfig().git.botName} <${BOT}>`,
    );
  });

  it("keeps the actor as the author when no attribution is passed", async () => {
    await commitPrivateAccess(
      { "access/skills.yaml": "skills: {}\n" },
      { message: "seed", authorName: "Admin User", authorEmail: "admin@example.com" },
    );

    expect(git(bareDir, "log", "portal-memory", "-1", "--format=%an <%ae>")).toBe(
      "Admin User <admin@example.com>",
    );
  });

  it("still refuses when the actor lacks manageAccess, whoever it names as the author", async () => {
    const result = await commitPrivateAccess(
      { "access/skills.yaml": "skills: {}\n" },
      {
        message: "escalate",
        authorName: "viewer@example.com",
        authorEmail: "viewer@example.com",
        onBehalfOf: { name: "admin@example.com", email: "admin@example.com" },
      },
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(() => git(bareDir, "show", "portal-memory:access/skills.yaml")).toThrow();
  });
});
