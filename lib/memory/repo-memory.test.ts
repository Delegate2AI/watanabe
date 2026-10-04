import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "@/lib/repo";
import { log } from "@/lib/log";
import { commitMemory, ensureMemoryWorktree, GIT_AUTHOR } from "./repo-memory";

/**
 * Real local-git integration fixture, mirroring `lib/repo-write.test.ts`: a
 * bare "remote" repo standing in for the real GitLab project, but reached via
 * `MEMORY_ORIGIN_OVERRIDE` (a plain filesystem path) instead of mocking
 * `remoteUrlWithToken`: repo-memory.ts's `originUrl()` checks that override
 * before falling back to the real token-based remote. `run`/`existsSync` stay
 * real; no network, no gitlab.com.
 */

let bare: string;
let checkout: string;
const saved = { ...process.env };

beforeEach(async () => {
  const base = mkdtempSync(path.join(tmpdir(), "mem-"));
  bare = path.join(base, "origin.git");
  checkout = path.join(base, "memco");
  await run("git", ["init", "--bare", bare]);
  process.env.MEMORY_CHECKOUT_DIR = checkout;
  process.env.REPO_WRITE_TOKEN = "x";
  process.env.MEMORY_ORIGIN_OVERRIDE = bare;
});

afterEach(() => {
  process.env = { ...saved };
  if (bare) rmSync(path.dirname(bare), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ensureMemoryWorktree", () => {
  it("creates and seeds a fresh portal-memory branch when the remote has none", async () => {
    const ok = await ensureMemoryWorktree();
    expect(ok).toBe(true);
    expect(existsSync(path.join(checkout, "memory", "CLAUDE.md"))).toBe(true);
    // The shared index seeds INSIDE the group tree, where a dream can actually
    // write it. Seeding memory/MEMORY.md left an index no tool could update.
    expect(existsSync(path.join(checkout, "memory", "shared", "all-hands", "MEMORY.md"))).toBe(true);
    expect(existsSync(path.join(checkout, "memory", "MEMORY.md"))).toBe(false);
    // pushed to origin:
    const branches = await run("git", ["-C", bare, "branch", "--list", "portal-memory"]);
    expect(branches).toContain("portal-memory");
  });

  it("is idempotent on a second call (reuses the existing checkout)", async () => {
    await ensureMemoryWorktree();
    const ok = await ensureMemoryWorktree();
    expect(ok).toBe(true);
    const gov = readFileSync(path.join(checkout, "memory", "CLAUDE.md"), "utf8");
    expect(gov.length).toBeGreaterThan(0);
  });
});

describe("commitMemory", () => {
  it("commits and pushes a staged memory change with a Memory-For trailer", async () => {
    await ensureMemoryWorktree();
    // memory/shared/ is not seeded by ensureMemoryWorktree, so create it first.
    await mkdir(path.join(checkout, "memory", "shared"), { recursive: true });
    await writeFile(path.join(checkout, "memory", "shared", "note.md"), "hello", "utf8");
    const res = await commitMemory({ message: "test note", authorName: "Jane", authorEmail: "jane@example.com" });
    expect(res).toBe("committed");
    const commitLog = await run("git", ["-C", bare, "log", "--format=%B", "-n", "1", "portal-memory"]);
    expect(commitLog).toContain("Memory-For: jane@example.com");
  });

  it("returns 'nothing' when the worktree is clean", async () => {
    await ensureMemoryWorktree();
    const res = await commitMemory({ message: "noop", authorName: "Jane", authorEmail: "jane@example.com" });
    expect(res).toBe("nothing");
  });

  it("pushes a previously-stranded local commit even though the worktree is clean now", async () => {
    await ensureMemoryWorktree();
    // Simulate a prior commitMemory call that committed locally but then
    // failed to push (transient network error, non-fast-forward from another
    // pod, ...): commit directly on the checkout, bypassing commitMemory, so
    // the bare remote never sees it.
    await mkdir(path.join(checkout, "memory", "shared"), { recursive: true });
    await writeFile(path.join(checkout, "memory", "shared", "stranded.md"), "stranded content", "utf8");
    await run("git", ["-C", checkout, "add", "memory"]);
    await run("git", [
      "-C",
      checkout,
      ...GIT_AUTHOR,
      "commit",
      "-m",
      "memory: stranded commit\n\nMemory-For: jane@example.com",
    ]);
    const remoteBeforeLog = await run("git", ["-C", bare, "log", "--format=%H", "-n", "1", "portal-memory"]);
    // The checkout's worktree is clean (nothing staged or unstaged); a naive
    // "clean worktree means nothing to do" check would return early here and
    // strand the commit forever.
    const res = await commitMemory({ message: "later note", authorName: "Jane", authorEmail: "jane@example.com" });
    expect(res).toBe("committed");
    const remoteLog = await run("git", ["-C", bare, "log", "--format=%B", "-n", "2", "portal-memory"]);
    expect(remoteLog).toContain("stranded commit");
    const remoteAfterLog = await run("git", ["-C", bare, "log", "--format=%H", "-n", "1", "portal-memory"]);
    expect(remoteAfterLog).not.toBe(remoteBeforeLog);
  });

  it("aborts a stuck rebase after a real conflict, so a later call is not wedged on stale rebase state", async () => {
    await ensureMemoryWorktree();
    await mkdir(path.join(checkout, "memory", "shared"), { recursive: true });
    await writeFile(path.join(checkout, "memory", "shared", "note.md"), "line one\n", "utf8");
    await run("git", ["-C", checkout, "add", "memory"]);
    await run("git", [...["-C", checkout], ...GIT_AUTHOR, "commit", "-m", "seed note"]);
    await run("git", ["-C", checkout, "push", bare, "portal-memory:portal-memory"]);

    // A second, independent clone of the same remote simulates another pod
    // pushing a conflicting change to the same line, so `checkout`'s next
    // rebase below hits a real, unresolvable-by-git conflict.
    const otherCheckout = path.join(path.dirname(bare), "other-memco");
    await run("git", ["clone", "--branch", "portal-memory", bare, otherCheckout]);
    await writeFile(path.join(otherCheckout, "memory", "shared", "note.md"), "line one, remote change\n", "utf8");
    await run("git", ["-C", otherCheckout, "add", "memory"]);
    await run("git", [...["-C", otherCheckout], ...GIT_AUTHOR, "commit", "-m", "remote change"]);
    await run("git", ["-C", otherCheckout, "push", bare, "portal-memory:portal-memory"]);

    // A conflicting local edit to the same line: commitMemory's own commit
    // step will land this, then its `rebase FETCH_HEAD` will conflict
    // against the remote change pushed above.
    await writeFile(path.join(checkout, "memory", "shared", "note.md"), "line one, local change\n", "utf8");
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const first = await commitMemory({ message: "local change", authorName: "Jane", authorEmail: "jane@example.com" });
    expect(first).toBe("failed");
    // Before the fix, a conflicted `rebase FETCH_HEAD` left `.git/rebase-merge`
    // (or `.git/rebase-apply`, depending on backend) in place forever.
    expect(existsSync(path.join(checkout, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(path.join(checkout, ".git", "rebase-apply"))).toBe(false);

    // Without the cleanup, this second call's `rebase FETCH_HEAD` would fail
    // immediately with git's "already a rebase-merge/apply directory" error
    // instead of re-attempting the real rebase, wedging every future call on
    // the persistent volume until someone manually cleared the directory.
    const second = await commitMemory({ message: "retry", authorName: "Jane", authorEmail: "jane@example.com" });
    expect(second).toBe("failed");
    expect(existsSync(path.join(checkout, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(path.join(checkout, ".git", "rebase-apply"))).toBe(false);
    const secondErr = String(errorSpy.mock.calls.at(-1)?.[1]?.err ?? "");
    expect(secondErr).not.toMatch(/already a rebase-(merge|apply) directory/i);

    errorSpy.mockRestore();
  });
});
