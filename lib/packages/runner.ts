import fs from "node:fs/promises";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { getPackage, markProcessing, markSubmitted, markNoChanges, markFailed } from "@/lib/db/packages";
import { recordThread } from "@/lib/db/threads";
import { packageDir } from "./config";
import { buildPackagesOptions } from "./options";
import { ensureWorktree, worktreeExists, worktreeVaultRoot, diff, discard, submit } from "@/lib/repo-write";
import { getGitHost } from "@/lib/git-host";
import { sanitizeMrDescription } from "./mr-description";
import { log } from "@/lib/log";
import { captureUsage } from "@/lib/usage/capture";

/**
 * One package's whole headless integration job — creates a synthetic thread
 * for the uploader, copies the package archive into it, runs the headless
 * SDK agent to integrate the content, then lands (or rejects) the result.
 * See docs/superpowers/specs/2026-07-09-update-package-ingestion-design.md
 * §2 for the design this implements verbatim.
 *
 * Every step from here on writes its outcome into the `packages` row via
 * `lib/db/packages.ts` — this function NEVER throws. A boot-time sweep
 * (`requeueStuckProcessing`) recovers a package left in `processing` by a
 * crashed process; this function's own top-level try/catch recovers
 * everything else that happens to go wrong mid-run into a `failed` row
 * instead of an unhandled rejection.
 */
export async function runPackageJob(packageId: string, deps?: { db?: DatabaseType }): Promise<void> {
  const db = deps?.db ?? getDb();
  const threadId = "pkg-" + packageId;
  // Hoisted so the catch-all below can still attach whatever report the
  // agent produced, even if the crash happened AFTER a successful run (e.g.
  // `diff`/`submit` throwing something `submit`'s own try/catch didn't
  // already turn into a `{ok:false}` result).
  let report: string | undefined;

  try {
    const pkg = getPackage(db, packageId);
    if (!pkg || pkg.status !== "queued") return; // not this job's turn — nothing to do

    markProcessing(db, packageId, threadId);

    // Fail fast, before spending any agent budget: submitting the change via
    // an MR is the whole point of this job, so a missing write token means
    // there is nothing this run could ever accomplish.
    const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
    if (!writeToken) {
      markFailed(db, packageId, { error: "write_unavailable" });
      return;
    }

    recordThread(db, threadId, pkg.ownerEmail, "Package: " + pkg.name);

    // A boot-time requeue (`requeueStuckProcessing`) moves a row stuck in
    // `processing` back to `queued` after a crash, but the crashed run's
    // worktree itself survives: `sweepOrphanWorktrees` only removes
    // UNregistered directories, and `ensureWorktree` below happily reuses a
    // registered one. Discarding any pre-existing worktree for this exact
    // thread id BEFORE `ensureWorktree` guarantees every run starts from a
    // clean `origin/main` checkout, never on top of a half-finished prior
    // attempt's staged edits (which `submit`'s `git add -A` would otherwise
    // silently fold into this run's MR).
    if (worktreeExists(threadId)) {
      await discard(threadId);
    }
    await ensureWorktree(threadId);

    // Verbatim archive copy — BEFORE the agent runs (deviation #3 in the
    // design doc): kb_stage_edit's mechanical quality gates would reject the
    // package's raw prose, so plain fs.cp lands it directly, and `git add -A`
    // at diff/submit time picks the copy up like any other staged file. The
    // sanitized name doubles as what `buildPackagesOptions` tells the agent
    // (both the system-prompt archive reference and this job's own user
    // prompt), so the location the agent is told about and the location this
    // copy actually lands at can never drift apart.
    const archiveDir = sanitizeArchiveDirName(pkg.name);
    const packageDirAbs = packageDir(packageId);
    const archiveAbsPath = path.join(worktreeVaultRoot(threadId), "99-reference", "handoffs", archiveDir);
    await fs.cp(packageDirAbs, archiveAbsPath, { recursive: true });
    const archiveRelPath = `99-reference/handoffs/${archiveDir}/`;

    const options = buildPackagesOptions({
      threadId,
      ownerEmail: pkg.ownerEmail,
      ownerName: pkg.ownerName ?? undefined,
      packageDirAbs,
      packageName: archiveDir,
    });

    const agentResult = await runAgent({
      prompt: buildJobPrompt({ packageName: pkg.name, packageDirAbs, archiveRelPath }),
      options,
    });
    report = agentResult.report;
    const failure = agentResult.failure;

    if (failure !== undefined) {
      // Worktree (and the archive already copied into it) is deliberately
      // left in place — the draft view lets the uploader inspect what the
      // agent got through before it failed.
      markFailed(db, packageId, { error: failure, report: report ?? null });
      return;
    }
    if (report === undefined) {
      markFailed(db, packageId, { error: "agent session ended without a result message" });
      return;
    }

    const staged = await diff(threadId);
    if (staged.trim() === "") {
      // The archive copy alone always makes the diff non-empty (see the
      // comment above) — an empty diff here means the copy itself somehow
      // produced nothing (e.g. an empty package), not that the agent found
      // no work: still resolved as "no changes", never treated as a failure.
      markNoChanges(db, packageId, report);
      await discard(threadId);
      return;
    }

    const result = await submit(threadId, {
      message: `Integrate update package: ${pkg.name}`,
      slug: slugify(pkg.name),
      authorName: pkg.ownerName ?? pkg.ownerEmail,
      authorEmail: pkg.ownerEmail,
      mode: "mr", // package runs are always MR — human review happens on the MR, never a direct push.
      writeToken,
    });

    if (!result.ok) {
      // `submit` only removes the worktree on success — a conflict or other
      // push failure leaves it intact for draft inspection / a later retry.
      const error = "conflict" in result ? `merge conflict in: ${result.files.join(", ")}` : result.error;
      markFailed(db, packageId, { error, report });
      return;
    }

    try {
      const mr = await getGitHost().createChangeRequest({
        sourceBranch: result.branch,
        title: `Integrate update package: ${pkg.name}`,
        // Untrusted input: `report` is the agent's summary of an uploaded
        // package, which GitLab would otherwise scan for quick actions
        // (/merge, /approve, ...) and execute as the bot token, see
        // `./mr-description.ts`.
        description: sanitizeMrDescription(report),
        token: writeToken,
      });
      markSubmitted(db, packageId, { mrUrl: mr.webUrl, report });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The branch is already pushed at this point (submit() succeeded) —
      // say so explicitly, since the change isn't lost, just not yet visible
      // as an MR.
      markFailed(db, packageId, { error: `branch ${result.branch} pushed, MR creation failed: ${message}`, report });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("package job crashed", { packageId, err: message });
    try {
      markFailed(db, packageId, { error: message, report: report ?? null });
    } catch (dbErr) {
      // The DB write itself failed — nothing more this function can do
      // without risking a throw out of a function documented to never throw.
      log.error("package job: markFailed after crash also failed", { packageId, err: String(dbErr) });
    }
  }
}

/** Drive the SDK query to completion, resolving to the report (success) or a failure message (error subtype / spawn or auth failure). Never throws. */
async function runAgent(params: {
  prompt: string;
  options: Parameters<typeof query>[0]["options"];
}): Promise<{ report?: string; failure?: string }> {
  let report: string | undefined;
  let failure: string | undefined;
  try {
    const q = query({ prompt: params.prompt, options: params.options });
    for await (const msg of q) {
      if (msg.type !== "result") continue;
      captureUsage(msg, { source: "packages", ownerEmail: null, threadId: null });
      if (msg.subtype === "success") {
        report = msg.result;
      } else {
        failure = msg.errors && msg.errors.length > 0 ? msg.errors.join("; ") : msg.subtype;
      }
    }
  } catch (err) {
    // A spawn/auth failure (bad credential, CLI binary missing, etc.) throws
    // out of the async iterator itself rather than yielding a result message.
    failure = err instanceof Error ? err.message : String(err);
  }
  return { report, failure };
}

/** The single user message that kicks off one package's integration job — short, since the full skill lives in the system prompt (`./prompt.ts`, wired by `./options.ts`). */
function buildJobPrompt(p: { packageName: string; packageDirAbs: string; archiveRelPath: string }): string {
  return [
    `Integrate the uploaded update package "${p.packageName}" into the vault.`,
    `Its normalized files live at ${p.packageDirAbs}.`,
    `A verbatim copy has already been placed inside your worktree at ${p.archiveRelPath}.`,
    `Follow the integration instructions in your system prompt, then finish this session`,
    `by writing your final message as the complete markdown integration report.`,
  ].join(" ");
}

/**
 * A package's display name, reduced to a single safe path segment for the
 * archive directory under `99-reference/handoffs/` — same character class as
 * `lib/repo-write.ts`'s `SAFE_ID` plus `.`, since a package name may
 * reasonably contain a version-style dot (e.g. "handoff-v11.2"). A name with
 * no safe characters at all falls back to a fixed segment rather than
 * collapsing to an empty (and therefore unsafe/ambiguous) path piece.
 */
function sanitizeArchiveDirName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "package";
}

/** A package's display name, reduced to the branch-slug shape `submit()` requires (`/^[a-z0-9-]+$/`). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "update-package";
}
