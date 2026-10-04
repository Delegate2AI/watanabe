import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getConfig } from "@/lib/config";
import { getProjection } from "@/lib/authority/cache";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { authUsernameFor, gitHostKind } from "@/lib/git-host/kind";
import { memoryWorktreeDir } from "@/lib/memory/config";


export function repoUrl(): string {
  return process.env.REPO_URL?.trim() ?? "";
}
const DEFAULT_BRANCH = "main";

function checkoutDir(): string {
  const override = process.env.REPO_CHECKOUT_DIR?.trim();
  // turbopackIgnore: resolved against an env var, not project files — see the
  // same rationale on repoRoot()/vaultRoot() below.
  return override ? path.resolve(/* turbopackIgnore: true */ process.cwd(), override) : "/data/repo";
}

/**
 * Local-dev checkout path, resolved against cwd like the old REPO_ROOT did.
 *
 * `LOCAL_REPO_PATH` (env) beats `repo.path` (portal.yaml), matching the
 * precedence in `lib/config/load.ts`. The token rule below is unchanged and
 * applies to BOTH sources: a config file must not be able to disable
 * clone-on-boot in a real deploy just by naming a path.
 */
function localDevPath(): string | null {
  const local = process.env.LOCAL_REPO_PATH?.trim() || getConfig().repo.path?.trim();
  const token = process.env.REPO_READ_TOKEN?.trim();
  // Local dev only kicks in when a checkout path is given AND no read token is
  // configured. If REPO_READ_TOKEN is set we're either a real deploy or a
  // deliberate token-based test of the clone path — either way, use the
  // managed checkout, not a developer's local path.
  if (local && !token) return local;
  return null;
}

export function repoRoot(): string {
  const local = localDevPath();
  // turbopackIgnore: this path.resolve() is evaluated against an env var, not
  // project files — nothing here needs to be included in Turbopack's Node
  // File Trace for the standalone build (see the longer note on the same
  // pattern in refreshRepo() below).
  if (local) return path.resolve(/* turbopackIgnore: true */ process.cwd(), local);
  return checkoutDir();
}

/**
 * `vaultRoot()`'s subdir logic, generalized to take the repo root explicitly
 * rather than always calling `repoRoot()`. Exported so the write path
 * (`lib/repo-write.ts`) can compute "the vault subdirectory inside THIS
 * worktree" using the identical `VAULT_SUBDIR` semantics, instead of the one
 * `/data/repo` checkout `vaultRoot()` is hardwired to.
 */
export function resolveVaultRoot(root: string): string {
  // `VAULT_SUBDIR` (env) beats `repo.vaultSubdir` (portal.yaml). An empty
  // string is meaningful, so presence is tested rather than truthiness.
  const raw = process.env.VAULT_SUBDIR ?? getConfig().repo.vaultSubdir;
  // Default to the KB's `docs/` vault; treat "." / "" as "repo root is the vault".
  const sub = raw == null ? "docs" : raw.trim();
  if (sub === "" || sub === ".") return root;
  // turbopackIgnore: same rationale as repoRoot() — this join is over an env
  // var, not project files, so it must not be pulled into the standalone trace.
  return path.join(/* turbopackIgnore: true */ root, sub);
}

export function unfilteredVaultRoot(): string {
  return resolveVaultRoot(repoRoot());
}

function currentAccessVersion(): string {
  const accessDir = path.join(memoryWorktreeDir(), "access");
  const hash = createHash("sha256");
  for (const file of ["groups.yaml", "roles.yaml"]) {
    try {
      hash.update(readFileSync(path.join(accessDir, file), "utf8"));
    } catch {
      hash.update("unavailable");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function vaultRootFor(clearanceSet: string[]): string {
  const root = unfilteredVaultRoot();
  return isAuthorityEnabled()
    ? getProjection(clearanceSet, { groupsHash: currentAccessVersion() })
    : root;
}

export function vaultRoot(): string {
  return vaultRootFor(["all-hands"]);
}

/**
 * Whether the knowledge-base vault the chat agent actually reads is present AND
 * populated on disk. Used by `/api/ready`'s readiness check
 * (`app/api/ready/route.ts`).
 *
 * "Present" alone is not enough: an empty/just-`mkdir`'d `/data/repo` (or a
 * vault dir that exists but whose clone never landed) would pass a bare
 * `existsSync`. So we require the vault directory to exist AND hold at least one
 * entry — that is what "the KB is actually on the PVC" means.
 */
export function vaultExists(): boolean {
  try {
    const root = vaultRoot();
    // turbopackIgnore: filesystem access over a runtime path, not project files.
    return readdirSync(/* turbopackIgnore: true */ root).length > 0;
  } catch {
    return false;
  }
}

// ── clone / refresh ─────────────────────────────────────────────────────────

/**
 * Run a subprocess, collecting stdout/stderr, rejecting on non-zero exit.
 * Exported so `lib/repo-write.ts` (the write-path's worktree/commit/push
 * plumbing) shares the identical subprocess-invocation shape rather than
 * duplicating it.
 */
export function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
  });
}

export function remoteUrlWithToken(token: string): string {
  const url = new URL(repoUrl());
  url.username = authUsernameFor(gitHostKind(url.hostname, process.env.GIT_HOST));
  url.password = token;
  return url.toString();
}

/** Strip a secret value out of an error message before it's ever logged. */
function redact(message: string, secret: string): string {
  return secret ? message.split(secret).join("***") : message;
}

/**
 * Clone-on-boot / refresh-on-boot for the managed checkout at `checkoutDir()`.
 * Called from `instrumentation.ts` once at server startup, and safe to call
 * again at other points (e.g. session start) if that's ever wired up.
 *
 * Resilience contract (mirrors `/api/health`'s philosophy — a downstream
 * dependency must never flap the pod): this function NEVER throws. Any
 * failure (network error, bad token, missing `/data`, etc.) is caught and
 * logged; the app keeps starting and serves from whatever's already at
 * `checkoutDir()` (stale-but-present is fine), or from nothing (the agent
 * just won't find `docs/` and will say so, per its system prompt).
 */
export async function refreshRepo(): Promise<void> {
  if (localDevPath()) {
    console.log("[repo] LOCAL_REPO_PATH is set — skipping clone/refresh, using the local checkout.");
    return;
  }

  const token = process.env.REPO_READ_TOKEN?.trim();
  const dir = checkoutDir();
  if (!repoUrl()) {
    console.error(
      "[repo] REPO_URL is not set and there is no local checkout, so there is no knowledge-base repo to clone. " +
        `The agent will read whatever (if anything) already exists at ${dir}.`,
    );
    return;
  }
  if (!token) {
    console.error(
      "[repo] REPO_READ_TOKEN is not set — cannot clone/refresh the docs repo. " +
        `The agent will read whatever (if anything) already exists at ${dir}.`,
    );
    return;
  }

  // `dir` is resolved once above (from an env var, never user/request input),
  // but it's still a variable rather than an inline literal, which makes
  // Turbopack's Node File Trace treat the path.*() calls below as "dynamic"
  // and fall back to tracing the whole project into the standalone build
  // output. The `turbopackIgnore` comments opt those calls out of tracing —
  // safe here since none of this filesystem access needs to be bundled/traced
  // at all (it runs against the runtime-mounted PVC, not project files).
  try {
    // Inside the try on purpose: with `REPO_URL` env-supplied, a malformed
    // value makes `new URL()` throw, and that must hit the same
    // catch/redact/log path as any other failure (never-throws contract).
    const remote = remoteUrlWithToken(token);
    await mkdir(path.dirname(/* turbopackIgnore: true */ dir), { recursive: true });

    if (existsSync(path.join(/* turbopackIgnore: true */ dir, ".git"))) {
      console.log(`[repo] Existing checkout at ${dir} — fetching latest ${DEFAULT_BRANCH}.`);
      await run("git", ["-C", dir, "remote", "set-url", "origin", remote]);
      await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", DEFAULT_BRANCH]);
      await run("git", ["-C", dir, "reset", "--hard", `origin/${DEFAULT_BRANCH}`]);
    } else {
      console.log(`[repo] No checkout at ${dir} — cloning ${repoUrl()}.`);
      await run("git", ["clone", "--depth", "1", "--branch", DEFAULT_BRANCH, remote, dir]);
    }

    const sha = await run("git", ["-C", dir, "rev-parse", "HEAD"]);
    console.log(`[repo] Docs repo ready at ${dir} @ ${sha}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[repo] Failed to clone/refresh docs repo at ${dir}: ${redact(message, token)}`);
    // Deliberately swallowed — see the resilience contract in the doc comment
    // above. A failed clone/fetch must never take the server down.
  }
}

/**
 * One-time unshallow of the managed checkout, so the write path's `git
 * rebase` (`lib/repo-write.ts`) has real history to rebase against.
 * `refreshRepo()` clones/fetches with `--depth 1` for the read-only path
 * (cheap, and rebase was never needed there) — a shallow repo has no common
 * ancestor with `origin/main` once the remote moves past the shallow
 * boundary, so `git rebase` fails outright on a shallow clone.
 *
 * Called once at boot, right after `refreshRepo()`, gated on
 * `KB_WRITE_ENABLED=1` (see `instrumentation.ts`) — once unshallowed, every
 * later `git fetch` (read or write path) is an ordinary incremental fetch on
 * top of full history, so this only does real work once per checkout's
 * lifetime, not once per boot. Origin's remote URL already carries
 * `REPO_READ_TOKEN` (set by `refreshRepo()`'s `remote set-url`/`clone`), so
 * this fetch needs no separate credential.
 *
 * Same resilience contract as `refreshRepo()`: NEVER throws. A failure here
 * surfaces later as an ordinary rebase-conflict error out of `kb_submit`,
 * rather than crashing the server.
 */
export async function ensureFullHistoryForWrite(): Promise<void> {
  if (localDevPath()) return; // a developer's own checkout is never shallow-cloned by this app
  const dir = checkoutDir();
  try {
    if (!existsSync(path.join(/* turbopackIgnore: true */ dir, ".git"))) return; // nothing to unshallow yet
    const isShallow = await run("git", ["-C", dir, "rev-parse", "--is-shallow-repository"]);
    if (isShallow.trim() !== "true") return;
    console.log(`[repo] Unshallowing ${dir} for write-path rebase support.`);
    await run("git", ["-C", dir, "fetch", "--unshallow", "origin", DEFAULT_BRANCH]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const token = process.env.REPO_READ_TOKEN?.trim() ?? "";
    console.error(`[repo] Failed to unshallow ${dir}: ${redact(message, token)}`);
    // Deliberately swallowed — same resilience contract as refreshRepo().
  }
}
