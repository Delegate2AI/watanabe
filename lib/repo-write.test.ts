import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/lib/config";

/**
 * Real local-git integration fixture: a bare "remote" repo (standing in for
 * the real GitLab project) + a working "checkout" cloned from it (standing
 * in for `/data/repo`, i.e. what `repoRoot()` resolves to via
 * `LOCAL_REPO_PATH`) + a scratch worktrees directory. Everything below runs
 * against real `git` over plain filesystem paths — no network, no
 * gitlab.com — which is why `lib/repo.ts`'s `remoteUrlWithToken` (the one
 * function that would otherwise always resolve to the real project URL) is
 * partially mocked to redirect the write path's push destination at the
 * local bare fixture; `repoRoot`/`resolveVaultRoot`/`run` stay real.
 */

let tmpRoot: string;
let bareDir: string;
let checkoutDir: string;
let worktreesDir: string;

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

const {
  ensureWorktree,
  worktreePath,
  worktreeVaultRoot,
  diff,
  submit,
  discard,
  sweepOrphanWorktrees,
  changedFiles,
  isSafeThreadId,
  worktreeExists,
  commitPrivateAccess,
} = await import("./repo-write");

const ENV_KEYS = [
  "LOCAL_REPO_PATH",
  "REPO_READ_TOKEN",
  "VAULT_SUBDIR",
  "WORKTREE_ROOT",
  "MEMORY_ORIGIN_OVERRIDE",
  "MEMORY_CHECKOUT_DIR",
  "BOOTSTRAP_ADMINS",
] as const;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repo-write-test-"));
  bareDir = path.join(tmpRoot, "remote.git");
  checkoutDir = path.join(tmpRoot, "checkout");
  worktreesDir = path.join(tmpRoot, "worktrees");

  git(tmpRoot, "init", "--bare", "-b", "main", bareDir);

  const seedDir = path.join(tmpRoot, "seed");
  git(tmpRoot, "clone", bareDir, seedDir);
  git(seedDir, "config", "user.email", "seed@example.com");
  git(seedDir, "config", "user.name", "Seed");
  writeVaultFile(seedDir, "overview.md", "# Overview\n");
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
  process.env.MEMORY_ORIGIN_OVERRIDE = bareDir;
  process.env.MEMORY_CHECKOUT_DIR = path.join(tmpRoot, "memory");
  process.env.BOOTSTRAP_ADMINS = "admin@example.com";
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  for (const k of ENV_KEYS) delete process.env[k];
});

const submitParams = (overrides: Partial<Parameters<typeof submit>[1]> = {}) => ({
  message: "test edit",
  slug: "test-edit",
  authorName: "Alice Contributor",
  authorEmail: "alice@example.com",
  mode: "direct" as const,
  writeToken: "unused-in-tests",
  ...overrides,
});

describe("commitPrivateAccess", () => {
  it("commits only access files to portal-memory with human author attribution", async () => {
    const result = await commitPrivateAccess(
      {
        "access/groups.yaml": "groups:\n  exec: [alice@example.com]\n",
        "access/roles.yaml": "roles:\n  admin: [admin@example.com]\ndefault: viewer\n",
      },
      { message: "update access", authorName: "Admin User", authorEmail: "admin@example.com" },
    );

    expect(result).toEqual({ ok: true });
    expect(git(bareDir, "show", "portal-memory:access/groups.yaml")).toContain("alice@example.com");
    expect(git(bareDir, "show", "portal-memory:access/roles.yaml")).toContain("admin@example.com");
    expect(git(bareDir, "log", "portal-memory", "-1", "--format=%an <%ae>|%cn <%ce>|%s")).toBe(
      `Admin User <admin@example.com>|${getConfig().git.botName} <${getConfig().git.botEmail}>|update access`,
    );
    expect(() => git(bareDir, "show", "main:access/groups.yaml")).toThrow();
  });

  it("refuses to follow a symlink committed at an allow-listed name", async () => {
    // The allow-list vets the requested name, not where that name leads. A
    // symlink COMMITTED to the private ref is the real shape of this: the
    // working tree is clean, so the pending-changes guard never fires, and git
    // keeps reporting it clean afterwards because the link text never changes.
    // Self-population means an ordinary sign-in reaches this code, so an
    // admin-only threat model is not enough.
    await commitPrivateAccess(
      { "access/groups.yaml": "groups:\n  exec: [alice@example.com]\n" },
      { message: "seed", authorName: "Admin", authorEmail: "admin@example.com" },
    );

    const escapeTarget = path.join(tmpRoot, "escaped.txt");
    fs.writeFileSync(escapeTarget, "original", "utf8");

    // Plant the symlink on the branch itself, the way a compromised or
    // mistaken earlier commit would have.
    const attacker = path.join(tmpRoot, "attacker");
    git(tmpRoot, "clone", "--branch", "portal-memory", bareDir, attacker);
    git(attacker, "config", "user.email", "attacker@example.com");
    git(attacker, "config", "user.name", "Attacker");
    fs.symlinkSync(escapeTarget, path.join(attacker, "access", "roles.yaml"));
    git(attacker, "add", "access/roles.yaml");
    git(attacker, "commit", "-m", "plant");
    git(attacker, "push", "origin", "portal-memory");

    const result = await commitPrivateAccess(
      { "access/roles.yaml": "roles:\n  admin: [attacker@example.com]\ndefault: viewer\n" },
      { message: "escape", authorName: "Admin", authorEmail: "admin@example.com" },
    );

    expect(result).toEqual({ ok: false, error: "invalid private access path" });
    expect(fs.readFileSync(escapeTarget, "utf8")).toBe("original");
  });

  it("refuses paths outside the fixed access allow-list", async () => {
    const result = await commitPrivateAccess(
      { "docs/escape.md": "unsafe" } as unknown as Record<"access/groups.yaml", string>,
      { message: "unsafe", authorName: "Admin", authorEmail: "admin@example.com" },
    );

    expect(result).toEqual({ ok: false, error: "invalid private access path" });
    expect(() => git(bareDir, "show", "portal-memory:docs/escape.md")).toThrow();
  });

  it("denies a non-admin before writing private access files", async () => {
    const result = await commitPrivateAccess(
      { "access/groups.yaml": "groups: {}\n" },
      { message: "unsafe", authorName: "Viewer", authorEmail: "viewer@example.com" },
    );

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(() => git(bareDir, "show", "portal-memory:access/groups.yaml")).toThrow();
  });
});

describe("ensureWorktree", () => {
  it("creates a detached worktree at origin/main", async () => {
    const dest = await ensureWorktree("thread-1");
    expect(dest).toBe(worktreePath("thread-1"));
    expect(fs.existsSync(path.join(dest, "docs", "overview.md"))).toBe(true);
    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list).toContain(dest);
  });

  it("is idempotent — a second call for the same thread reuses the existing worktree", async () => {
    const first = await ensureWorktree("thread-1");
    const second = await ensureWorktree("thread-1");
    expect(second).toBe(first);
    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list.split(first).length - 1).toBe(1); // appears exactly once
  });

  it("concurrent calls for the same new thread don't race (mutex serializes them)", async () => {
    const [a, b] = await Promise.all([ensureWorktree("thread-race"), ensureWorktree("thread-race")]);
    expect(a).toBe(b);
    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list.split(a).length - 1).toBe(1);
  });

  it("rejects an unsafe thread id instead of building a path from it", async () => {
    await expect(ensureWorktree("../escape")).rejects.toThrow(/unsafe thread id/);
  });
});

describe("worktreeVaultRoot", () => {
  it("resolves to the worktree's docs/ subdirectory", async () => {
    const dest = await ensureWorktree("thread-1");
    expect(worktreeVaultRoot("thread-1")).toBe(path.join(dest, "docs"));
  });
});

describe("diff", () => {
  it("reflects a staged new file under the vault, scoped to the vault subdir", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");
    const result = await diff("thread-1");
    expect(result).toContain("new-page.md");
  });

  it("is empty when nothing has changed", async () => {
    await ensureWorktree("thread-1");
    const result = await diff("thread-1");
    expect(result.trim()).toBe("");
  });

  it("with a pathFilter, shows only that file's diff even when multiple files are staged", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "overview.md"), "# Overview\n\nEdited.\n");

    const scoped = await diff("thread-1", "new-page.md");
    expect(scoped).toContain("new-page.md");
    expect(scoped).not.toContain("overview.md");
  });
});

describe("changedFiles", () => {
  it("reports an added, a modified, and a deleted file with vault-relative paths", async () => {
    const dest = await ensureWorktree("thread-1");
    const root = worktreeVaultRoot("thread-1");

    // Commit a file directly into this worktree's own history (bypassing this
    // module entirely) so there's something already-tracked to delete —
    // git only reports a "D" status for a file that exists in HEAD.
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.writeFileSync(path.join(root, "sub", "existing.md"), "will be deleted\n");
    git(dest, "add", "-A");
    git(dest, "commit", "-m", "seed a file to delete");

    fs.writeFileSync(path.join(root, "new-page.md"), "# New page\n");
    fs.writeFileSync(path.join(root, "overview.md"), "# Overview\n\nEdited.\n");
    fs.rmSync(path.join(root, "sub", "existing.md"));

    const result = await changedFiles("thread-1");
    expect(result).toEqual(
      expect.arrayContaining([
        { path: "new-page.md", status: "added" },
        { path: "overview.md", status: "modified" },
        { path: "sub/existing.md", status: "deleted" },
      ]),
    );
  });

  it("returns [] when nothing is staged", async () => {
    await ensureWorktree("thread-1");
    expect(await changedFiles("thread-1")).toEqual([]);
  });

  it("still stages an untracked new file (git add -A) before reporting it", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "untracked.md"), "content\n");
    expect(await changedFiles("thread-1")).toEqual([{ path: "untracked.md", status: "added" }]);
  });
});

describe("isSafeThreadId / worktreeExists", () => {
  it("isSafeThreadId accepts alphanumeric/underscore/hyphen only", () => {
    expect(isSafeThreadId("abc-123_XYZ")).toBe(true);
    expect(isSafeThreadId("../escape")).toBe(false);
    expect(isSafeThreadId("has space")).toBe(false);
    expect(isSafeThreadId("")).toBe(false);
  });

  it("worktreeExists is false before creation, true after, false after discard", async () => {
    expect(worktreeExists("thread-1")).toBe(false);
    await ensureWorktree("thread-1");
    expect(worktreeExists("thread-1")).toBe(true);
    await discard("thread-1");
    expect(worktreeExists("thread-1")).toBe(false);
  });

  it("worktreeExists is false (not throwing) for an unsafe id", () => {
    expect(worktreeExists("../escape")).toBe(false);
  });
});

describe("submit", () => {
  it("returns an error, not a throw, when nothing is staged", async () => {
    await ensureWorktree("thread-1");
    const result = await submit("thread-1", submitParams());
    expect(result).toEqual({ ok: false, error: expect.stringContaining("nothing staged") });
  });

  it("direct mode: commits with the given author and pushes straight to main", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");

    const result = await submit("thread-1", submitParams({ mode: "direct" }));

    expect(result).toEqual({ ok: true, branch: "main" });
    const log = git(bareDir, "log", "main", "-1", "--format=%an <%ae> %s");
    expect(log).toBe("Alice Contributor <alice@example.com> test edit");
    expect(git(bareDir, "show", "main:docs/new-page.md")).toBe("# New page");
  });

  it("commits with a bot committer distinct from the human author, even with no ambient git identity configured", async () => {
    // Reproduces the real production failure mode: the deployed container has
    // no ~/.gitconfig and no GIT_COMMITTER_* env, unlike this fixture's own
    // checkoutDir (which the beforeEach above configures identity on, and
    // which every OTHER test here silently relies on since a worktree shares
    // its linked repo's config) — without a bot committer set explicitly,
    // `git commit` would fail outright with "unable to auto-detect email
    // address", leaving the file staged forever.
    git(checkoutDir, "config", "--unset", "user.email");
    git(checkoutDir, "config", "--unset", "user.name");

    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");

    const result = await submit("thread-1", submitParams({ mode: "direct" }));

    expect(result).toEqual({ ok: true, branch: "main" });
    const log = git(bareDir, "log", "main", "-1", "--format=%an <%ae>|%cn <%ce>");
    const [author, committer] = log.split("|");
    expect(author).toBe("Alice Contributor <alice@example.com>");
    expect(committer).not.toBe(author);
    expect(committer).toContain(getConfig().git.botName);
  });

  it("direct mode: prunes the worktree after a successful submit", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");
    await submit("thread-1", submitParams({ mode: "direct" }));

    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list).not.toContain(worktreePath("thread-1"));
  });

  it("mr mode: pushes to a new kb/<user>/<slug>-<timestamp> branch, leaving main untouched", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");

    const result = await submit("thread-1", submitParams({ mode: "mr", slug: "add-new-page" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.branch).toMatch(/^kb\/alice-example-com\/add-new-page-\d+$/);
    const branches = git(bareDir, "branch", "--list", "kb/*");
    expect(branches).toContain(result.branch);
    expect(() => git(bareDir, "show", `main:docs/new-page.md`)).toThrow(); // main is unchanged
    expect(git(bareDir, "show", `${result.branch}:docs/new-page.md`)).toBe("# New page");
  });

  it("never force-pushes: a conflicting direct-mode submit surfaces as a conflict, not an overwrite", async () => {
    await ensureWorktree("thread-a");
    await ensureWorktree("thread-b");

    fs.writeFileSync(path.join(worktreeVaultRoot("thread-a"), "overview.md"), "# Overview\n\nEdited by A.\n");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-b"), "overview.md"), "# Overview\n\nEdited by B.\n");

    const first = await submit("thread-a", submitParams({ mode: "direct", message: "A's edit" }));
    expect(first.ok).toBe(true);

    const second = await submit("thread-b", submitParams({ mode: "direct", message: "B's edit" }));
    expect(second).toMatchObject({ ok: false, conflict: true });
    if (second.ok || !("conflict" in second)) throw new Error("unreachable");
    expect(second.files).toContain("docs/overview.md");

    // A's commit must still be on main, untouched — B's conflict must not have forced anything.
    expect(git(bareDir, "show", "main:docs/overview.md")).toContain("Edited by A.");

    // thread-b's worktree survives the conflict so a retry is possible.
    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list).toContain(worktreePath("thread-b"));
  });

  it("never logs or returns the write token, even on failure", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "new-page.md"), "# New page\n");
    // Force a failure downstream of the token substitution by pointing the
    // (mocked) push destination at a nonexistent path instead of the bare repo.
    const badRemote = path.join(tmpRoot, "does-not-exist.git");
    const original = bareDir;
    bareDir = badRemote;
    try {
      const result = await submit("thread-1", submitParams({ writeToken: "super-secret-write-token" }));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("super-secret-write-token");
    } finally {
      bareDir = original;
    }
  });
});

describe("discard", () => {
  it("removes a worktree without committing anything", async () => {
    await ensureWorktree("thread-1");
    fs.writeFileSync(path.join(worktreeVaultRoot("thread-1"), "scratch.md"), "scratch\n");

    await discard("thread-1");

    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list).not.toContain(worktreePath("thread-1"));
    expect(() => git(bareDir, "show", "main:docs/scratch.md")).toThrow();
  });

  it("is safe to call twice (already-gone is not an error)", async () => {
    await ensureWorktree("thread-1");
    await discard("thread-1");
    await expect(discard("thread-1")).resolves.toBeUndefined();
  });
});

describe("sweepOrphanWorktrees", () => {
  it("removes a stray unregistered directory but keeps a registered worktree", async () => {
    const kept = await ensureWorktree("thread-kept");
    const strayDir = path.join(worktreesDir, "stray-thread");
    fs.mkdirSync(strayDir, { recursive: true });
    fs.writeFileSync(path.join(strayDir, "junk.txt"), "leftover");

    await sweepOrphanWorktrees();

    expect(fs.existsSync(strayDir)).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
    const list = git(checkoutDir, "worktree", "list", "--porcelain");
    expect(list).toContain(kept);
  });

  it("never throws, even if worktreesRoot() doesn't exist yet", async () => {
    await expect(sweepOrphanWorktrees()).resolves.toBeUndefined();
  });
});
