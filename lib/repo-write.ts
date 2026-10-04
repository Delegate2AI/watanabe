import { existsSync, realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, resolveVaultRoot, remoteUrlWithToken, run } from "@/lib/repo";
import { getConfig } from "@/lib/config";

/**
 * Resolve `p` to its real, symlink-free absolute form when it exists on disk;
 * fall back to a plain lexical resolve when it doesn't (a path that doesn't
 * exist yet obviously can't match any real worktree `git worktree list`
 * reports, so a lexical resolve is a safe fallback there).
 *
 * Needed because `git worktree list --porcelain` reports paths in their
 * real, resolved form, while `worktreesRoot()`/`worktreePath()` are built
 * from `WORKTREE_ROOT`/`process.cwd()` without resolving symlinks — on macOS
 * in particular, `/var/...` (a symlink to `/private/var/...`) would
 * otherwise silently fail every path-equality check below, making a valid,
 * already-registered worktree look unregistered.
 */
function realOrResolved(p: string): string {
  try {
    // turbopackIgnore: `p` is a runtime-computed worktree/checkout path, not
    // a project file — same rationale as the other dynamic fs calls in this
    // module.
    return realpathSync(/* turbopackIgnore: true */ p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Worktree + git plumbing for the write path — every `mcp__kb__kb_stage_*`/
 * `kb_diff`/`kb_discard`/`kb_submit` tool (see `lib/kb-mcp/write-tools.ts`)
 * goes through this module, never touches `git` directly itself.
 *
 * Core invariant: staging NEVER touches `repoRoot()` (the checkout the read
 * path and the web view serve from) — every edit happens inside a per-thread
 * `git worktree`, a separate working directory that shares the same object
 * store/refs as `repoRoot()` but has its own independent index and HEAD. A
 * half-finished draft can never be visible to another user, and a confused or
 * malicious tool call can never corrupt what everyone else is reading.
 *
 * The worktree key is the thread's SDK session id (not a fresh id per
 * `AgentSession` instance) — see `lib/kb-mcp/write-tools.ts` for how that id
 * reaches these functions. That means a thread's in-progress draft survives a
 * warm-session eviction/resume: the next `kb_stage_edit` in the same thread
 * finds its existing worktree rather than starting over. Only a genuine
 * server restart (via `sweepOrphanWorktrees`, run at boot) or an explicit
 * `kb_discard`/successful `kb_submit` clears it.
 *
 * All git operations shell out to the real `git` CLI via `run()` (shared with
 * `lib/repo.ts`'s read-only clone/fetch/reset), never a git library.
 */

/** Default location for per-thread worktrees, override via `WORKTREE_ROOT`. */
function worktreesRoot(): string {
  const override = process.env.WORKTREE_ROOT?.trim();
  // turbopackIgnore: resolved against an env var, not project files — same
  // rationale as lib/repo.ts's checkoutDir()/repoRoot().
  return override ? path.resolve(/* turbopackIgnore: true */ process.cwd(), override) : "/data/worktrees";
}

/** Only safe path-segment characters — a thread id is never trusted as a raw path component. */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Whether `id` is safe to use as a worktree path segment — the exact rule
 * `worktreePath` enforces, exposed as a non-throwing predicate for callers
 * (the draft view's access guard, `lib/agent/draft-access.ts`) that need to
 * check-then-branch on an externally-supplied id rather than catch a thrown
 * error.
 */
export function isSafeThreadId(id: string): boolean {
  return SAFE_ID.test(id);
}

/**
 * The on-disk path for a thread's worktree. `threadId` is validated against
 * `SAFE_ID` before it's ever joined into a path — it originates from the
 * SDK's own session id, which this module doesn't control the shape of, so it
 * must never be trusted as a safe path segment unchecked.
 */
export function worktreePath(threadId: string): string {
  if (!isSafeThreadId(threadId)) {
    throw new Error(`refusing to build a worktree path from an unsafe thread id: "${threadId}"`);
  }
  return path.join(worktreesRoot(), threadId);
}

/** The Obsidian vault subdirectory inside a thread's worktree — what the write tools' containment check runs against. */
export function worktreeVaultRoot(threadId: string): string {
  return resolveVaultRoot(worktreePath(threadId));
}

/**
 * Whether a thread's worktree directory exists on disk right now — a plain,
 * cheap existence check (no `git` shell-out) for read-path guard chains (the
 * draft view — see `lib/agent/draft-access.ts`) that need to decide "render
 * draft mode or fall back" without paying for `git worktree list`. This is
 * NOT an ownership check — see `checkDraftAccess`, which composes this with
 * `lib/db/ownership.ts`'s `isOwnedBy`.
 */
export function worktreeExists(threadId: string): boolean {
  // turbopackIgnore: the path is runtime-computed (worktreesRoot() + a thread
  // id), not a project file — same rationale as the other dynamic fs calls in
  // this module (see worktreesRoot()/sweepOrphanWorktrees()).
  return isSafeThreadId(threadId) && existsSync(/* turbopackIgnore: true */ worktreePath(threadId));
}

// ── per-thread serialization ─────────────────────────────────────────────
// Two overlapping calls for the same thread (e.g. a resume race producing a
// second AgentSession for a moment) must never touch the same worktree
// concurrently. A tiny in-process mutex — chain each call onto the previous
// one for the same threadId — is sufficient given the single-replica RWO-PVC
// deploy (no cross-pod contention is possible).

const locks = new Map<string, Promise<unknown>>();

function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(threadId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  // Swallow so a failed call doesn't poison the chain for the next caller —
  // the real error still propagates to whoever awaits `next` below.
  locks.set(
    threadId,
    next.catch(() => {}),
  );
  return next;
}

// ── worktree listing ──────────────────────────────────────────────────────

/** Every worktree path `git worktree list` currently knows about (including `repoRoot()` itself). */
async function listWorktreePaths(): Promise<string[]> {
  const root = repoRoot();
  const output = await run("git", ["-C", root, "worktree", "list", "--porcelain"]);
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length).trim());
  }
  return paths;
}

async function hasRegisteredWorktree(threadId: string): Promise<boolean> {
  const target = realOrResolved(worktreePath(threadId));
  const registered = await listWorktreePaths();
  return registered.some((p) => realOrResolved(p) === target);
}

// ── lifecycle ───────────────────────────────────────────────────────────

/**
 * Create (or reuse) a thread's worktree, detached at a freshly fetched
 * `origin/main`. Idempotent: a second call for the same thread that already
 * has a registered worktree is a no-op and just returns its path.
 */
export async function ensureWorktree(threadId: string): Promise<string> {
  return withThreadLock(threadId, async () => {
    const dest = worktreePath(threadId);
    if (await hasRegisteredWorktree(threadId)) return dest;

    const root = repoRoot();
    // turbopackIgnore: worktreesRoot() is runtime-computed (env var or
    // /data/worktrees), not a project file — same rationale as the other
    // dynamic fs calls in this module.
    await mkdir(/* turbopackIgnore: true */ worktreesRoot(), { recursive: true });
    await run("git", ["-C", root, "fetch", "origin", "main"]);
    await run("git", ["-C", root, "worktree", "add", "--detach", dest, "origin/main"]);
    return dest;
  });
}

/**
 * The actual worktree-removal logic, WITHOUT acquiring the per-thread lock —
 * for callers that already hold it (`submit`'s success path, below). Never
 * throws on "already gone".
 */
async function removeWorktreeUnlocked(threadId: string): Promise<void> {
  const root = repoRoot();
  const dest = worktreePath(threadId);
  try {
    await run("git", ["-C", root, "worktree", "remove", "--force", dest]);
  } catch {
    // Already removed, never existed, or the directory was hand-deleted —
    // `worktree prune` below cleans up the registration either way.
  }
  await run("git", ["-C", root, "worktree", "prune"]).catch(() => {});
}

/**
 * Drop a thread's worktree (an explicit discard, or a sweep). Never throws on
 * "already gone".
 *
 * NOTE: `submit`'s own success path removes the worktree by calling
 * `removeWorktreeUnlocked` directly rather than this function — it's already
 * holding this thread's lock at that point, and `withThreadLock` is not
 * reentrant, so calling this (lock-acquiring) function from inside an
 * already-locked `submit` would deadlock forever waiting on itself.
 */
export async function discard(threadId: string): Promise<void> {
  await withThreadLock(threadId, () => removeWorktreeUnlocked(threadId));
}

/**
 * The staged, uncommitted diff for a thread's worktree, scoped to the vault
 * subdirectory (or, when `pathFilter` is given, to one file within it —
 * spec 12 D28's per-file diff panel) — computed server-side so what the
 * contributor is shown (and what a `kb_submit` confirmation is granted
 * against) is exactly what's on disk, never something the model merely
 * claims. Always stages everything under the WHOLE vault first (`git add -A`
 * over `vaultSubdir`, never over the narrower `pathFilter` scope) so untracked
 * new files show up too, without actually committing — `pathFilter` only
 * narrows what the returned diff *shows*, not what gets staged.
 */
export async function diff(threadId: string, pathFilter?: string): Promise<string> {
  const dest = worktreePath(threadId);
  const vaultSubdir = path.relative(dest, worktreeVaultRoot(threadId)) || ".";
  const scope = pathFilter ? path.join(vaultSubdir, pathFilter) : vaultSubdir;
  await run("git", ["-C", dest, "add", "-A", "--", vaultSubdir]);
  return run("git", ["-C", dest, "diff", "--cached", "--", scope]);
}

export type ChangedFile = { path: string; status: "added" | "modified" | "deleted" };

const CHANGED_STATUS_MAP: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted" };

/**
 * Name-status of everything staged so far in a thread's worktree, scoped to
 * the vault subdirectory — same `git add -A` pre-stage as `diff()`, so a
 * fresh untracked file counts too. Returned paths are VAULT-relative (the
 * same shape `resolveVaultEntry`/the tree's hrefs use), not repo-relative —
 * git reports paths relative to `dest` (the repo root), scoped by the
 * `vaultSubdir` pathspec, so `path.relative(vaultSubdir, reported)` strips
 * that prefix back off (this also correctly no-ops when `vaultSubdir` is
 * `"."`, since `path.relative(".", x) === x`).
 *
 * `--no-renames` is deliberate: this portal's write tools are whole-file
 * (`kb_stage_edit`/`kb_stage_delete`), so there is no rename affordance to
 * represent — forcing git to report a rename as a plain delete + add (spec 12
 * D24) keeps every entry a single, independently-badge-able file.
 */
export async function changedFiles(threadId: string): Promise<ChangedFile[]> {
  const dest = worktreePath(threadId);
  const vaultSubdir = path.relative(dest, worktreeVaultRoot(threadId)) || ".";
  await run("git", ["-C", dest, "add", "-A", "--", vaultSubdir]);
  const out = await run("git", [
    "-C",
    dest,
    "diff",
    "--cached",
    "--name-status",
    "--no-renames",
    "--",
    vaultSubdir,
  ]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      const code = line.slice(0, tabIdx);
      const reportedPath = line.slice(tabIdx + 1);
      const relToVault = path.relative(vaultSubdir, reportedPath).split(path.sep).join("/");
      return { path: relToVault, status: CHANGED_STATUS_MAP[code[0]] ?? "modified" };
    });
}

/**
 * The staged, uncommitted diff for a SINGLE file in a thread's worktree:
 * the same `git add -A` + `git diff --cached` shape `diff()` uses above,
 * scoped by pathspec to just this one file instead of the whole vault
 * subdirectory. Used by `kb_stage_edit`'s mechanical quality gate
 * (`isQualityGatesEnabled()`, see `lib/kb-mcp/write-tools.ts`) to compute the
 * ADDED lines of only the file it just wrote, relative to that file's last
 * committed (HEAD) content, never the rest of the vault.
 */
export async function diffFile(threadId: string, absPath: string): Promise<string> {
  const dest = worktreePath(threadId);
  const rel = path.relative(dest, absPath);
  await run("git", ["-C", dest, "add", "-A", "--", rel]);
  return run("git", ["-C", dest, "diff", "--cached", "--", rel]);
}

/**
 * Undo a single staged file inside a thread's worktree: unstage it, then
 * restore the file to `priorContent`, the worktree content it had BEFORE
 * this `kb_stage_edit` call wrote the rejected content, not HEAD. Passing
 * `null` means the file did not exist before this call, so it's deleted
 * rather than restored.
 *
 * Restoring to HEAD (as an earlier version of this function did) is wrong
 * whenever a PRIOR `kb_stage_edit` in the same thread already staged a valid
 * edit to this same path: a `git checkout HEAD -- <rel>` would silently
 * discard that earlier, still-valid staged edit along with the rejected one.
 * Snapshotting the caller's pre-write content and restoring exactly that
 * preserves any earlier staged edit while still undoing only this call's
 * write. Used by `kb_stage_edit` to unstage an edit that fails the
 * mechanical quality gate, so a rejected edit never lingers for a later
 * `kb_diff`/`kb_submit` to pick up.
 */
export async function restoreFile(threadId: string, absPath: string, priorContent: string | null): Promise<void> {
  const dest = worktreePath(threadId);
  const rel = path.relative(dest, absPath);
  await run("git", ["-C", dest, "reset", "--", rel]).catch(() => {});
  if (priorContent === null) {
    await rm(absPath, { force: true });
  } else {
    await writeFile(absPath, priorContent, "utf8");
  }
}

export type SubmitParams = {
  message: string;
  /** Sanitized branch slug — caller (`lib/kb-mcp/write-tools.ts`) validates this against `/^[a-z0-9-]+$/` before it ever reaches here. */
  slug: string;
  authorName: string;
  authorEmail: string;
  /** `"mr"` pushes a new branch; `"direct"` pushes straight to `main` (fast-forward only — never forced). */
  mode: "mr" | "direct";
  /** GitLab Project Access Token used ONLY for the push itself — never logged, never returned. */
  writeToken: string;
};

export type SubmitResult =
  | { ok: true; branch: string }
  | { ok: false; conflict: true; files: string[] }
  | { ok: false; error: string };

/** Strip a secret value out of an error message before it's ever logged or returned. */
export function redact(message: string, secret: string): string {
  return secret ? message.split(secret).join("***") : message;
}

/**
 * `git commit` needs a resolvable COMMITTER identity in addition to the
 * `--author` override below — spec 10 D11: "committer = the bot, author =
 * the human". Nothing in this deployment's container configures a git
 * identity (no `~/.gitconfig`, no `GIT_COMMITTER_*` env), so without this,
 * `git commit` fails outright with "unable to auto-detect email address"
 * and the worktree is left with everything staged but never committed —
 * `-c` scopes these to this one invocation only, no global state touched.
 */
export const BOT_COMMITTER_NAME = getConfig().git.botName;
export const BOT_COMMITTER_EMAIL = getConfig().git.botEmail;


async function conflictedFiles(dest: string): Promise<string[]> {
  const out = await run("git", ["-C", dest, "diff", "--name-only", "--diff-filter=U"]).catch(() => "");
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Rebase the worktree onto the latest `origin/main`. Returns conflicted file paths on failure (and leaves the rebase aborted, worktree clean). */
async function rebaseOntoOrigin(dest: string): Promise<{ ok: true } | { ok: false; files: string[] }> {
  try {
    await run("git", ["-C", dest, "rebase", "origin/main"]);
    return { ok: true };
  } catch {
    const files = await conflictedFiles(dest);
    await run("git", ["-C", dest, "rebase", "--abort"]).catch(() => {});
    return { ok: false, files };
  }
}

/**
 * Commit the thread's staged edits and push them — `mr` mode to a new
 * `kb/<user>/<slug>-<timestamp>` branch, `direct` mode straight to `main`.
 * Never force-pushes and never rewrites already-pushed history: a rebase
 * conflict is retried once (fetch + rebase again) and, failing that, handed
 * back to the caller as `{conflict: true}` with the worktree left intact so a
 * follow-up attempt (after the contributor resolves it, or just retries
 * later) can pick up where this one left off — nothing here discards work.
 */
export async function submit(threadId: string, params: SubmitParams): Promise<SubmitResult> {
  return withThreadLock(threadId, async () => {
    const root = repoRoot();
    const dest = worktreePath(threadId);
    const vaultSubdir = path.relative(dest, worktreeVaultRoot(threadId)) || ".";

    try {
      await run("git", ["-C", dest, "add", "-A", "--", vaultSubdir]);
      const staged = await run("git", ["-C", dest, "diff", "--cached", "--name-only", "--", vaultSubdir]);
      if (staged.trim() === "") return { ok: false, error: "nothing staged — there is no edit to submit" };

      await run("git", [
        "-C",
        dest,
        "-c",
        `user.name=${BOT_COMMITTER_NAME}`,
        "-c",
        `user.email=${BOT_COMMITTER_EMAIL}`,
        "commit",
        "-m",
        params.message,
        "--author",
        `${params.authorName} <${params.authorEmail}>`,
      ]);

      await run("git", ["-C", root, "fetch", "origin", "main"]);
      let rebased = await rebaseOntoOrigin(dest);
      if (!rebased.ok) {
        // One retry: the conflict may have been a stale fetch racing another
        // writer, not a real content conflict.
        await run("git", ["-C", root, "fetch", "origin", "main"]);
        rebased = await rebaseOntoOrigin(dest);
      }
      if (!rebased.ok) return { ok: false, conflict: true, files: rebased.files };

      const remote = remoteUrlWithToken(params.writeToken);
      const timestamp = Date.now();
      const branch = params.mode === "mr" ? `kb/${sanitizeUserSegment(params.authorEmail)}/${params.slug}-${timestamp}` : "main";
      const refspec = `HEAD:refs/heads/${branch}`;

      try {
        // No --force anywhere: a `direct`-mode push to `main` is naturally
        // fast-forward-only without it; an `mr`-mode push is always a brand
        // new branch, so there is nothing to force over.
        await run("git", ["-C", dest, "push", remote, refspec]);
      } catch (err) {
        if (params.mode === "direct") {
          // Another direct push landed on `main` between our rebase and this
          // push — retry once (re-fetch, re-rebase, re-push), same discipline
          // as the rebase-conflict retry above.
          await run("git", ["-C", root, "fetch", "origin", "main"]);
          const retryRebase = await rebaseOntoOrigin(dest);
          if (!retryRebase.ok) return { ok: false, conflict: true, files: retryRebase.files };
          await run("git", ["-C", dest, "push", remote, refspec]);
        } else {
          throw err;
        }
      }

      // Not `discard()` — that re-acquires this same thread's lock, which
      // `submit` (via `withThreadLock`, above) is already holding; see
      // `removeWorktreeUnlocked`'s doc comment.
      await removeWorktreeUnlocked(threadId);
      return { ok: true, branch };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: redact(message, params.writeToken) };
    }
  });
}

/** `user@example.com` → `user-example-com`, safe for a git ref path segment. */
function sanitizeUserSegment(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
}

/**
 * Boot-time cleanup: drop any worktree registration whose directory is gone
 * (a `worktree prune`), and force-remove any stray directory under
 * `worktreesRoot()` that ISN'T a registered worktree (e.g. a half-created one
 * from a pod that died mid-`ensureWorktree`). Every removal is checked for
 * containment inside `worktreesRoot()` first, so a bug here can never reach
 * outside it — in particular, never `repoRoot()` itself.
 *
 * Same resilience contract as `lib/repo.ts`'s `refreshRepo()`: NEVER throws.
 * A failure here must not take the server down; it just leaves a stray
 * directory for the next boot to try again.
 */
export async function sweepOrphanWorktrees(): Promise<void> {
  const root = repoRoot();
  const wtRoot = worktreesRoot();
  try {
    await run("git", ["-C", root, "worktree", "prune", "-v"]);

    const { readdirSync } = await import("node:fs");
    let entries: string[];
    try {
      entries = readdirSync(/* turbopackIgnore: true */ wtRoot);
    } catch {
      return; // worktreesRoot() doesn't exist yet — nothing to sweep
    }

    const registered = new Set((await listWorktreePaths()).map((p) => realOrResolved(p)));
    for (const entry of entries) {
      const abs = path.resolve(wtRoot, entry);
      const rel = path.relative(wtRoot, abs);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue; // containment guard
      if (registered.has(realOrResolved(abs))) continue;
      console.log(`[repo-write] Removing orphaned worktree directory: ${abs}`);
      await run("git", ["-C", root, "worktree", "remove", "--force", abs]).catch(() => {});
      const { rm } = await import("node:fs/promises");
      // turbopackIgnore: `abs` is a runtime-computed worktree path, not a project file.
      await rm(/* turbopackIgnore: true */ abs, { recursive: true, force: true }).catch(() => {});
    }
    await run("git", ["-C", root, "worktree", "prune"]).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[repo-write] Orphan worktree sweep failed: ${message}`);
    // Deliberately swallowed — see the resilience contract above.
  }
}

// The private access write path lives in its own module now (it has its own
// allow-list and its own path-safety rules). Re-exported so every existing
// importer keeps working unchanged.
export { commitPrivateAccess, type PrivateAccessFiles } from "./repo-write-private-access";
