import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { refreshRepo } from "@/lib/repo";
import { runReconcile } from "@/lib/authority/reconcile-job";
import { hasJob, registerJob, type JobResult } from "./registry";
import { operatorJobs } from "./operator-jobs";

export function registerBuiltInJobs(db: DatabaseType = getDb()): void {
  if (!hasJob("repo-refresh")) {
    registerJob({
      name: "repo-refresh",
      flag: null,
      family: "maintenance",
      run: async (): Promise<JobResult> => {
        // refreshRepo() never throws (see its resilience contract in lib/repo.ts).
        // After it fast-forwards the checkout, the projection cache rebuilds
        // lazily on the next read because its key includes the vault SHA, so no
        // explicit invalidation call is needed here (spec 23).
        await refreshRepo();
        return { detail: "checkout refreshed" };
      },
    });
  }

  if (!hasJob("reconcile")) {
    registerJob({
      name: "reconcile",
      flag: "AUTHORITY_ENABLED",
      family: "maintenance",
      run: (): Promise<JobResult> => runReconcile(db),
    });
  }

  for (const job of operatorJobs) {
    if (!hasJob(job.name)) registerJob(job);
  }

  if (!hasJob("meetings-retry-failed")) {
    registerJob({
      name: "meetings-retry-failed",
      flag: "MEETINGS_ENABLED",
      family: "meetings",
      // Same family as the ingest jobs, so a replay cannot run alongside the
      // meeting it is replaying. Imported lazily to keep the runner (and the
      // git write path behind it) out of the boot graph.
      run: async (): Promise<JobResult> => {
        const { requeueFailedMeetings } = await import("@/lib/db/meetings");
        const { enqueueMeeting } = await import("@/lib/meetings/queue");
        const ids = requeueFailedMeetings(db);
        for (const id of ids) enqueueMeeting(id);
        return { detail: `requeued ${ids.length} failed meetings` };
      },
    });
  }
}
