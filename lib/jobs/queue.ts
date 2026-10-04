import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { getJob } from "./registry";
import { listProcessingRuns, recordFinish } from "./state";

type Runner = (id: string) => Promise<void>;

const g = globalThis as unknown as {
  __jobFamilyQueues?: Map<string, Promise<void>>;
};

function queues(): Map<string, Promise<void>> {
  return (g.__jobFamilyQueues ??= new Map());
}

export function enqueue(family: string, id: string, run: Runner): void {
  const prior = queues().get(family) ?? Promise.resolve();
  const next = prior.then(
    () => run(id),
    () => run(id),
  );
  queues().set(family, next.catch(() => undefined));
}

async function defaultRecoveryRunner(jobName: string): Promise<void> {
  const { runJob } = await import("./dispatch");
  await runJob(jobName);
}

export function bootJobs(db: DatabaseType = getDb(), run: Runner = defaultRecoveryRunner): void {
  for (const stuck of listProcessingRuns(db)) {
    const job = getJob(stuck.job);
    if (!job) continue;
    enqueue(job.family, job.name, async (jobName) => {
      recordFinish(db, stuck.id, "failed", "requeued after process restart");
      await run(jobName);
    });
  }
}

export function __resetJobQueuesForTests(): void {
  delete g.__jobFamilyQueues;
}

export function __resetJobQueueFamilyForTests(family: string): void {
  queues().delete(family);
}
