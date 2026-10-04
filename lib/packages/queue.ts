import type { Database as DatabaseType } from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { requeueStuckProcessing, listQueuedIds } from "@/lib/db/packages";
import { enqueue, __resetJobQueueFamilyForTests } from "@/lib/jobs/queue";
import { runPackageJob } from "./runner";

/**
 * In-process job queue for the update-package ingestion pipeline. Every
 * enqueued job runs strictly after every previously enqueued job resolves (or
 * rejects). Concurrency 1 by construction, not by a lock: there is exactly
 * one chain, so a second job's `run` is never even called until the first's
 * promise settles.
 *
 * Pinned to `globalThis`, same rationale as `lib/agent/session.ts`'s
 * `__agentChatSessions` (session.ts:658): Next.js can bundle route handlers
 * separately, so a plain module-level `let` would give different routes
 * different chains, and dev HMR would otherwise reset it on every edit.
 *
 * Serialization mirrors `lib/repo-write.ts`'s `withThreadLock`
 * (repo-write.ts:118-127): chain onto the prior promise with `.then(fn, fn)`
 * so a job runs regardless of whether the previous one resolved or rejected,
 * then store `next.catch(() => {})` so a rejection is swallowed at the queue
 * level and can never poison the chain for whatever gets enqueued next.
 * `runPackageJob` is documented to never throw, but the queue guards against
 * that contract being violated by any `run` a caller supplies.
 */

const PACKAGE_FAMILY = "packages";

/** Enqueue one package job. It runs only after every job enqueued before it has settled. */
export function enqueuePackage(packageId: string, run: (id: string) => Promise<void> = runPackageJob): void {
  enqueue(PACKAGE_FAMILY, packageId, run);
}

/**
 * Boot-time recovery + drain, called once from `instrumentation.ts` when
 * `isPackagesEnabled()`. Moves every package stuck in `processing` (left
 * there by a job runner that crashed mid-run) back to `queued`, then
 * enqueues every currently-`queued` package, which, thanks to that
 * ordering, naturally includes both the just-requeued ones and any that were
 * already `queued` before restart.
 */
export function bootPackages(db: DatabaseType = getDb()): void {
  requeueStuckProcessing(db);
  for (const id of listQueuedIds(db)) enqueuePackage(id);
}

/** Test-only: reset the pinned chain so each test starts from a clean queue. */
export function __resetPackagesQueueForTests(): void {
  __resetJobQueueFamilyForTests(PACKAGE_FAMILY);
}
