import { execFile } from "node:child_process";
import { lstatSync, readdirSync, rmSync, type Dirent } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { cloneBudget } from "./config";
import { ALLOWED_GIT_SCHEMES, checkGitRef, checkGitRemote, gitCloneArgs, resolveSubdir } from "./git-args";

const run = promisify(execFile);

/**
 * Git fetch half of the skill install pipeline (spec 34).
 *
 * Every guard on the untrusted remote, ref, and subdir lives in `./git-args`
 * and runs before anything is spawned. What this module adds:
 *
 * - **No shell, ever.** `execFile` with an argv array, matching `lib/repo.ts`'s
 *   `spawn(cmd, args)`. A remote containing `;`, backticks, or `$(...)` is one
 *   inert argv element.
 * - **`GIT_ALLOW_PROTOCOL`** pins the same scheme allow-list at the git level,
 *   and `GIT_TERMINAL_PROMPT=0` stops a private remote blocking on a prompt.
 * - **A byte and entry budget on the clone**, since `--depth=1` bounds history
 *   and not size. See `cloneBudget()` in `./config` and `createBudgetWalker`.
 *
 * Never throws: a clone failure, a timeout, or a missing git binary comes back
 * as `{ ok: false, reason }` with git's own stderr folded into the reason.
 */

export { ALLOWED_GIT_SCHEMES, checkGitRef, checkGitRemote, gitCloneArgs, resolveSubdir } from "./git-args";

export const GIT_TIMEOUT_MS = 60_000;

/** How often the running clone's staging directory is measured against the budget. */
export const CLONE_WATCH_INTERVAL_MS = 250;

/**
 * Entries examined per watchdog tick. See `createBudgetWalker` for why a tick
 * has to be bounded work rather than a full walk.
 */
export const CLONE_WATCH_ENTRIES_PER_TICK = 2_000;

export type GitFetchOptions = {
  url: string;
  ref: string;
  subdir?: string;
  timeoutMs?: number;
  maxCloneBytes?: number;
  maxCloneEntries?: number;
  watchIntervalMs?: number;
  entriesPerTick?: number;
};

export type GitFetchResult =
  | { ok: true; dir: string; commit: string; url: string; ref: string; subdir?: string }
  | { ok: false; reason: string };

export type CloneBudget = { maxBytes: number; maxEntries: number };

/**
 * Unreadable entries are skipped rather than thrown: this measures a directory
 * another process is actively writing, so a file vanishing between the readdir
 * and the lstat is normal.
 */
function readdirSafe(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** `lstat`, never `stat`: a symlink counts as its own size and is never followed. */
function sizeSafe(target: string): number {
  try {
    return lstatSync(target).size;
  } catch {
    return 0;
  }
}

/**
 * A resumable, work-capped measurement of a growing directory.
 *
 * The watchdog cannot re-walk the whole tree on every tick. Doing so measured
 * 235ms for a 41k-entry tree, which on the request event loop is roughly half
 * of a 250ms interval spent blocking, and a 200k-entry repo makes a tick longer
 * than the interval and saturates the loop for the whole clone. Repository file
 * count is attacker controlled, so that is a self-inflicted denial of service.
 *
 * So a `step()` examines at most `entriesPerTick` entries and then returns,
 * keeping its depth-first frames for the next call. The running byte and entry
 * totals persist across steps too, so the budget trips as soon as the CUMULATIVE
 * walk crosses it rather than only at the end of a full pass. When a pass does
 * complete, the walker resets and starts a fresh pass on the next tick. Work per
 * tick is therefore bounded by a constant regardless of how large the tree gets.
 *
 * Directories are counted as entries, not bytes: an empty directory still costs
 * a real block on disk (around 4KB) while contributing zero to a byte total, so
 * a repository of a million empty directories would otherwise measure as free.
 */
export type WalkStep = {
  /** Either limit was blown, by the cumulative walk so far. */
  over: boolean;
  /** Entries examined by THIS step. Never more than `entriesPerTick`. */
  examined: number;
  /** The pass finished; the next step starts a fresh one. */
  done: boolean;
};

export function createBudgetWalker(
  root: string,
  budget: CloneBudget,
  entriesPerTick: number,
): () => WalkStep {
  let frames: Array<{ dir: string; names: Dirent[]; i: number }> | null = null;
  let bytes = 0;
  let entries = 0;

  return function step(): WalkStep {
    if (frames === null) {
      const names = readdirSafe(root);
      if (names === null) return { over: false, examined: 0, done: true };
      frames = [{ dir: root, names, i: 0 }];
      bytes = 0;
      entries = 0;
    }

    let examined = 0;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as { dir: string; names: Dirent[]; i: number };
      if (frame.i >= frame.names.length) {
        frames.pop();
        continue;
      }
      const dirent = frame.names[frame.i++] as Dirent;
      const abs = path.join(frame.dir, dirent.name);
      examined += 1;
      entries += 1;
      if (entries > budget.maxEntries) return { over: true, examined, done: false };

      if (dirent.isDirectory()) {
        const names = readdirSafe(abs);
        if (names !== null) frames.push({ dir: abs, names, i: 0 });
      } else {
        bytes += sizeSafe(abs);
        if (bytes > budget.maxBytes) return { over: true, examined, done: false };
      }
      if (examined >= entriesPerTick) return { over: false, examined, done: false };
    }

    frames = null;
    return { over: false, examined, done: true };
  };
}

/**
 * One exact, uninterrupted measurement of `dir` against `budget`, bailing the
 * moment either limit is blown. This is the deterministic check that runs once
 * after the clone has settled; the watchdog uses the resumable walker above.
 */
export function directoryOverBudget(dir: string, budget: CloneBudget): boolean {
  return createBudgetWalker(dir, budget, Number.POSITIVE_INFINITY)().over;
}

function describeExecError(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text =
    typeof stderr === "string" && stderr.trim() !== ""
      ? stderr
      : error instanceof Error
        ? error.message
        : String(error);
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

/**
 * Shallow-clone `url` at `ref` into `stagingDir`, drop the `.git` plumbing, and
 * return the directory the caller should validate plus the resolved commit.
 * The returned directory is inside `stagingDir`, so the caller can rename it
 * into the store without copying.
 */
export async function fetchGitSkill(opts: GitFetchOptions, stagingDir: string): Promise<GitFetchResult> {
  const remote = checkGitRemote(opts.url);
  if (!remote.ok) return remote;
  const ref = checkGitRef(opts.ref);
  if (!ref.ok) return ref;

  const cloneDir = path.join(stagingDir, "clone");
  const timeout = opts.timeoutMs ?? GIT_TIMEOUT_MS;
  const env = {
    ...process.env,
    // No credential prompt can ever block the request thread on a private remote.
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: ALLOWED_GIT_SCHEMES.join(":"),
  };

  const configured = cloneBudget();
  const budget: CloneBudget = {
    maxBytes: opts.maxCloneBytes ?? configured.maxBytes,
    maxEntries: opts.maxCloneEntries ?? configured.maxEntries,
  };
  const overBudgetReason = `git clone exceeded its budget of ${budget.maxBytes} bytes or ${budget.maxEntries} entries`;
  let overBudget = false;

  let commit: string;
  try {
    const clone = run("git", gitCloneArgs(remote.value, ref.value, cloneDir), {
      timeout,
      env,
      maxBuffer: 1 << 20,
    });
    // The budget is enforced twice on purpose. The interval kills a runaway
    // clone while it is still running, which is what actually stops a hostile
    // repository filling the volume portal.db sits on. The check after the
    // await is the deterministic one: a clone that finishes between two ticks
    // is still refused, so the budget does not depend on timer scheduling.
    //
    // The ticking check is a RESUMABLE walk with a hard work cap, not a fresh
    // full-tree walk. A full walk per tick blocked the event loop in proportion
    // to repository size, which is attacker controlled. See `createBudgetWalker`.
    const stepWalk = createBudgetWalker(
      stagingDir,
      budget,
      opts.entriesPerTick ?? CLONE_WATCH_ENTRIES_PER_TICK,
    );
    const watchdog = setInterval(() => {
      if (!stepWalk().over) return;
      overBudget = true;
      clone.child.kill("SIGKILL");
    }, opts.watchIntervalMs ?? CLONE_WATCH_INTERVAL_MS);
    try {
      await clone;
    } finally {
      clearInterval(watchdog);
    }
    if (overBudget || directoryOverBudget(stagingDir, budget)) {
      return { ok: false, reason: overBudgetReason };
    }
    const { stdout } = await run("git", ["rev-parse", "HEAD"], {
      cwd: cloneDir,
      timeout,
      env,
      maxBuffer: 1 << 16,
    });
    commit = stdout.trim();
  } catch (error) {
    // A killed clone rejects with a signal, not a git diagnostic, so the budget
    // reason has to win over the generic one.
    if (overBudget) return { ok: false, reason: overBudgetReason };
    return { ok: false, reason: `git clone failed: ${describeExecError(error)}` };
  }
  if (!/^[0-9a-f]{7,64}$/.test(commit)) {
    return { ok: false, reason: `git rev-parse returned an unusable commit: "${commit}"` };
  }

  const dir = resolveSubdir(cloneDir, opts.subdir);
  if (!dir.ok) return dir;

  // The repository plumbing is not skill content: it would blow the validator's
  // file cap on any real repo, and it has no business sitting in the store.
  rmSync(path.join(cloneDir, ".git"), { recursive: true, force: true });

  const subdir = opts.subdir === undefined ? undefined : opts.subdir.trim();
  return { ok: true, dir: dir.value, commit, url: remote.value, ref: ref.value, subdir };
}
