import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { getLatestRun, listProcessingJobs } from "@/lib/jobs/state";
import type { JobResult } from "@/lib/jobs/registry";
import { isAuthorityEnabled } from "./config";

/**
 * The `reconcile` background job (spec 23): a nightly maintenance pass that
 * emits an authority/health summary. It is gated by `AUTHORITY_ENABLED`.
 *
 * Flag-off is a genuine no-op: when authority is disabled the function returns
 * immediately without touching the DB or logging a summary, so a CronJob (or a
 * direct `pnpm job reconcile`) firing before the phase is enabled does nothing.
 * The dispatch layer also gates this by the job's `flag` before the handler is
 * ever reached; this early return is the second, handler-level guard so the
 * behavior holds even if the handler is invoked directly.
 *
 * The summary reports what is derivable from state already owned by this lane:
 * the count of jobs stuck in `processing` and the outcome of the last
 * `meetings-poll`. Spec 23 also lists "prune stale projection cache entries" and
 * "projection cache size"; the projection cache (lib/authority/cache.ts) exposes
 * no public prune/size API today, and that module is outside this change's
 * scope, so those are intentionally omitted here. The cache already
 * self-invalidates lazily on a `(clearanceSet, sha, groupsHash)` key change, so
 * a stale entry is never served; an explicit eviction pass is a later addition.
 */
export async function runReconcile(db: DatabaseType = getDb()): Promise<JobResult> {
  if (!isAuthorityEnabled()) {
    return { detail: "authority disabled; reconcile skipped" };
  }

  const stuckJobs = listProcessingJobs(db);
  const lastPoll = getLatestRun(db, "meetings-poll");
  log.info("reconcile health summary", {
    stuckJobCount: stuckJobs.length,
    stuckJobs,
    lastMeetingsPoll: lastPoll
      ? { status: lastPoll.status, finishedAt: lastPoll.finishedAt }
      : null,
  });

  return { detail: `reconcile ok: ${stuckJobs.length} stuck job(s)` };
}
