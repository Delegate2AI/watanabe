import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { enqueue } from "./queue";
import { getJob } from "./registry";
import { hasProcessingRun, recordFinish, recordStart } from "./state";

export type DispatchResult =
  | { status: "unknown" }
  | { status: "disabled" }
  | { status: "noop" }
  | { status: "enqueued" };

export type JobExecutionResult = {
  status: "succeeded" | "failed";
  detail: string | null;
  runId: number | null;
};

const g = globalThis as unknown as { __pendingJobs?: Set<string> };

function pendingJobs(): Set<string> {
  return (g.__pendingJobs ??= new Set());
}

export function dispatch(jobName: string, db: DatabaseType = getDb()): DispatchResult {
  const job = getJob(jobName);
  if (!job) return { status: "unknown" };
  if (job.flag && process.env[job.flag] !== "1") return { status: "disabled" };
  if (pendingJobs().has(jobName) || hasProcessingRun(db, jobName)) return { status: "noop" };

  pendingJobs().add(jobName);
  enqueue(job.family, jobName, async (name) => {
    try {
      await runJob(name, db);
    } finally {
      pendingJobs().delete(name);
    }
  });
  return { status: "enqueued" };
}

export async function runJob(jobName: string, db: DatabaseType = getDb()): Promise<JobExecutionResult> {
  const job = getJob(jobName);
  if (!job) return { status: "failed", detail: `unknown job: ${jobName}`, runId: null };

  let runId: number;
  try {
    runId = recordStart(db, jobName);
  } catch (error) {
    const detail = String(error);
    log.error("job start failed", { job: jobName, error: detail });
    return { status: "failed", detail, runId: null };
  }

  log.info("job started", { job: jobName, runId });
  try {
    const result = await job.run();
    const detail = result?.detail ?? null;
    try {
      recordFinish(db, runId, "succeeded", detail);
    } catch (error) {
      log.error("job finish recording failed", { job: jobName, runId, error: String(error) });
      return { status: "failed", detail: String(error), runId };
    }
    log.info("job finished", { job: jobName, runId, status: "succeeded", detail });
    return { status: "succeeded", detail, runId };
  } catch (error) {
    const detail = String(error);
    try {
      recordFinish(db, runId, "failed", detail);
    } catch (finishError) {
      log.error("job finish recording failed", { job: jobName, runId, error: String(finishError) });
    }
    log.error("job finished", { job: jobName, runId, status: "failed", detail });
    return { status: "failed", detail, runId };
  }
}

export function __resetDispatchForTests(): void {
  delete g.__pendingJobs;
}
