import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { remoteUrlWithToken, run } from "@/lib/repo";
import { log } from "@/lib/log";
import { MEMORY_BRANCH, memoryCheckoutDir } from "./config";
import { governanceMarkdown } from "./governance";
import { getConfig } from "@/lib/config";

/**
 * Manages the `portal-memory` git worktree: a checkout of an ORPHAN branch that
 * carries only `memory/`, deliberately isolated from `main`'s content history.
 * Reuses `lib/repo.ts`'s `run`/`remoteUrlWithToken` so the subprocess and auth
 * shape match the read/write paths exactly. Same resilience contract as
 * `refreshRepo()`: bootstrap NEVER throws (returns false instead), so a memory
 * failure never flaps the pod.
 */

const GIT_AUTHOR = ["-c", "user.name=Portal Memory", "-c", `user.email=${getConfig().git.memoryEmail}`];

function originUrl(): string {
  const override = process.env.MEMORY_ORIGIN_OVERRIDE?.trim();
  if (override) return override;
  const token = process.env.REPO_WRITE_TOKEN?.trim();
  if (!token) throw new Error("REPO_WRITE_TOKEN is required to push portal-memory");
  return remoteUrlWithToken(token);
}

async function remoteHasBranch(remote: string): Promise<boolean> {
  const out = await run("git", ["ls-remote", "--heads", remote, MEMORY_BRANCH]);
  return out.trim().length > 0;
}

async function seedFreshBranch(dir: string, remote: string): Promise<void> {
  await run("git", ["-C", dir, "checkout", "--orphan", MEMORY_BRANCH]);
  await run("git", ["-C", dir, "reset", "--hard"]); // drop any files carried from the clone's default branch
  await mkdir(path.join(dir, "memory"), { recursive: true });
  await writeFile(path.join(dir, "memory", "CLAUDE.md"), governanceMarkdown(getConfig().agent.memoryRules), "utf8");
  // Seed the shared index at memory/shared/all-hands/MEMORY.md, NOT at
  // memory/MEMORY.md. The latter is outside the tool layer's writable scope,
  // so a dream could never update it: on the first branch seeded this way, it
  // kept the placeholder below across three dreams while the model quietly
  // maintained memory/shared/MEMORY.md instead. Seeding inside the group tree
  // means the index the agent reads is the same one it can write.
  await mkdir(path.join(dir, "memory", "shared", "all-hands"), { recursive: true });
  await writeFile(
    path.join(dir, "memory", "shared", "all-hands", "MEMORY.md"),
    "# Shared Memory Index (all-hands)\n\n_No shared memories yet._\n",
    "utf8",
  );
  await run("git", ["-C", dir, "add", "memory"]);
  await run("git", [...["-C", dir], ...GIT_AUTHOR, "commit", "-m", "chore(memory): initialize portal-memory branch"]);
  await run("git", ["-C", dir, "push", remote, `${MEMORY_BRANCH}:${MEMORY_BRANCH}`]);
}

/**
 * Ensure the `portal-memory` worktree exists locally and tracks the remote
 * branch, creating+seeding the branch if the remote has none. Idempotent.
 * Returns true when ready, false on any failure.
 */
export async function ensureMemoryWorktree(): Promise<boolean> {
  const dir = memoryCheckoutDir();
  try {
    const remote = originUrl();
    if (existsSync(path.join(dir, ".git"))) {
      await run("git", ["-C", dir, "fetch", remote, MEMORY_BRANCH]);
      await run("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"]);
      return true;
    }
    await mkdir(path.dirname(dir), { recursive: true });
    if (await remoteHasBranch(remote)) {
      await run("git", ["clone", "--depth", "1", "--branch", MEMORY_BRANCH, remote, dir]);
    } else {
      // No branch yet: clone default, then orphan+seed+push.
      await run("git", ["clone", "--depth", "1", remote, dir]);
      await seedFreshBranch(dir, remote);
    }
    return true;
  } catch (err) {
    log.error("[memory] ensureMemoryWorktree failed", { dir, err: String(err) });
    return false;
  }
}

export { originUrl, GIT_AUTHOR };

// A process-wide serial gate: only one dream/commit mutates the shared worktree
// at a time. Low memory volume makes a simple promise chain sufficient and
// avoids lost-update races on the single checkout. Exported so the dream
// runner can hold the lock across a full query and then call
// `commitMemoryLocked` directly inside it, instead of nesting through
// `commitMemory` (which would deadlock waiting on itself).
let queue: Promise<unknown> = Promise.resolve();
export function withMemoryLock<T>(fn: () => Promise<T>): Promise<T> {
  const held = queue.then(fn, fn);
  // keep the chain alive regardless of individual outcome
  queue = held.then(
    () => undefined,
    () => undefined,
  );
  return held;
}

async function isDirty(dir: string): Promise<boolean> {
  const status = await run("git", ["-C", dir, "status", "--porcelain", "memory"]);
  return status.trim().length > 0;
}

/**
 * Stage everything under `memory/` (if there is anything staged), commit as
 * the portal bot (with a `Memory-For` trailer naming the human the memory is
 * about), rebase onto the freshest remote `portal-memory`, and push whatever
 * ends up ahead, without force. Mirrors `lib/repo-write.ts`'s submit
 * discipline: pull-rebase then push, never `--force`.
 *
 * Fetches and checks "am I ahead of the remote" BEFORE deciding there is
 * nothing to do, rather than short-circuiting on a clean worktree. A clean
 * worktree does not mean there is nothing to push: a prior call may have
 * committed locally and then failed to push (transient network error, a
 * concurrent non-fast-forward from another pod, ...), leaving a stranded
 * commit on HEAD. If a later call reproduces the same content, the worktree
 * looks clean again and an early "nothing" return would leave that commit
 * behind forever (the caller marks the thread dreamed, and the next pod boot
 * `reset --hard`s to `FETCH_HEAD`, discarding it). Rebasing onto `FETCH_HEAD`
 * unconditionally replays any such stranded commit on top of the latest
 * remote before the ahead/behind check, so it gets swept up and pushed here.
 *
 * Assumes the caller already holds the memory lock (see `withMemoryLock`).
 * Exported directly for callers that already hold the lock across a larger
 * operation (the dream runner); everyone else should call `commitMemory`.
 */
export async function commitMemoryLocked(opts: {
  message: string;
  authorName: string;
  authorEmail: string;
}): Promise<"committed" | "nothing" | "failed"> {
  const dir = memoryCheckoutDir();
  try {
    const remote = originUrl();
    await run("git", ["-C", dir, "fetch", remote, MEMORY_BRANCH]);
    if (await isDirty(dir)) {
      await run("git", ["-C", dir, "add", "memory"]);
      const message = `${opts.message}\n\nMemory-For: ${opts.authorEmail}`;
      await run("git", [...["-C", dir], ...GIT_AUTHOR, "commit", "-m", message]);
    }
    // rebase onto latest remote so concurrent commits from other pods do not
    // need force, and so a previously-stranded local commit gets replayed
    // on top instead of silently left behind.
    await run("git", ["-C", dir, "rebase", "FETCH_HEAD"]);
    const ahead = await run("git", ["-C", dir, "rev-list", "--count", "FETCH_HEAD..HEAD"]);
    if (parseInt(ahead, 10) === 0) return "nothing";
    await run("git", ["-C", dir, "push", remote, `HEAD:${MEMORY_BRANCH}`]);
    return "committed";
  } catch (err) {
    log.error("[memory] commitMemory failed", { err: String(err) });
    // A conflicted `rebase FETCH_HEAD` above leaves `.git/rebase-merge` in
    // place on the persistent `/data/memory` volume; every later call would
    // otherwise keep failing with "rebase in progress" until someone clears
    // it by hand. Best-effort abort it here so the next attempt starts from
    // a clean worktree; ignore the abort's own outcome (there may be no
    // rebase in progress at all, e.g. when the failure was the fetch or the
    // push instead).
    await run("git", ["-C", dir, "rebase", "--abort"]).catch(() => {});
    // leave the worktree as-is otherwise; the next dream retries. Never throw.
    return "failed";
  }
}

/**
 * Public entry point: acquires the serial memory lock, then delegates to
 * `commitMemoryLocked`. Serialized so concurrent dreams never race the shared
 * worktree. Do not call this from inside code that already holds the lock
 * (call `commitMemoryLocked` there instead, or this deadlocks waiting on
 * itself).
 */
export async function commitMemory(opts: {
  message: string;
  authorName: string;
  authorEmail: string;
}): Promise<"committed" | "nothing" | "failed"> {
  return withMemoryLock(() => commitMemoryLocked(opts));
}
