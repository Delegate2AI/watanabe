import type { Database as DatabaseType } from "better-sqlite3";

/**
 * `packages` table access: the single source of truth for uploaded doc
 * packages and where each one sits in its ingestion lifecycle (see
 * `./client` for the connection/schema). Mirrors `lib/db/threads.ts`'s
 * shape: DB-instance-agnostic pure functions, directly unit-testable
 * against an in-memory database.
 *
 * Lifecycle: queued -> processing -> (submitted | no_changes | failed).
 * `failed` and `no_changes` are the only states `requeueForRetry` accepts
 * back to `queued`; `requeueStuckProcessing` is the boot-time sweep that
 * recovers packages left in `processing` by a crashed job runner.
 */

export type PackageStatus = "queued" | "processing" | "submitted" | "no_changes" | "failed";

export interface PackageRecord {
  id: string;
  ownerEmail: string;
  ownerName: string | null;
  name: string;
  status: PackageStatus;
  threadId: string | null;
  mrUrl: string | null;
  report: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PackageRow {
  id: string;
  owner_email: string;
  owner_name: string | null;
  name: string;
  status: PackageStatus;
  thread_id: string | null;
  mr_url: string | null;
  report: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: PackageRow): PackageRecord {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    name: row.name,
    status: row.status,
    threadId: row.thread_id,
    mrUrl: row.mr_url,
    report: row.report,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create a new package in `queued` status. */
export function insertPackage(
  db: DatabaseType,
  p: { id: string; ownerEmail: string; ownerName?: string | null; name: string },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO packages (id, owner_email, owner_name, name, status, created_at, updated_at)
     VALUES (@id, @ownerEmail, @ownerName, @name, 'queued', @now, @now)`,
  ).run({
    id: p.id,
    ownerEmail: p.ownerEmail,
    ownerName: p.ownerName ?? null,
    name: p.name,
    now,
  });
}

/** The package with `id`, or `null` if this store has no record of it. */
export function getPackage(db: DatabaseType, id: string): PackageRecord | null {
  const row = db.prepare(`SELECT * FROM packages WHERE id = ?`).get(id) as PackageRow | undefined;
  return row ? fromRow(row) : null;
}

/** All packages owned by `ownerEmail`, newest activity first. */
export function listPackagesForOwner(db: DatabaseType, ownerEmail: string): PackageRecord[] {
  const rows = db
    .prepare(`SELECT * FROM packages WHERE owner_email = ? ORDER BY updated_at DESC`)
    .all(ownerEmail) as PackageRow[];
  return rows.map(fromRow);
}

/** Move a package to `processing`, recording which agent thread is handling it. */
export function markProcessing(
  db: DatabaseType,
  id: string,
  threadId: string,
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `UPDATE packages SET status = 'processing', thread_id = @threadId, updated_at = @now WHERE id = @id`,
  ).run({ id, threadId, now });
}

/** Move a package to `submitted`: an MR was opened; records its URL and the run's report. */
export function markSubmitted(
  db: DatabaseType,
  id: string,
  r: { mrUrl: string; report: string },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `UPDATE packages SET status = 'submitted', mr_url = @mrUrl, report = @report, updated_at = @now WHERE id = @id`,
  ).run({ id, mrUrl: r.mrUrl, report: r.report, now });
}

/** Move a package to `no_changes`: the run completed but found nothing to integrate. */
export function markNoChanges(
  db: DatabaseType,
  id: string,
  report: string,
  now: string = new Date().toISOString(),
): void {
  db.prepare(`UPDATE packages SET status = 'no_changes', report = @report, updated_at = @now WHERE id = @id`).run({
    id,
    report,
    now,
  });
}

/** Move a package to `failed`, recording the error and an optional partial report. */
export function markFailed(
  db: DatabaseType,
  id: string,
  r: { error: string; report?: string | null },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `UPDATE packages SET status = 'failed', error = @error, report = @report, updated_at = @now WHERE id = @id`,
  ).run({ id, error: r.error, report: r.report ?? null, now });
}

/**
 * Requeue a package for another run. Only allowed from `failed` or
 * `no_changes`: refuses `queued` (already pending), `processing` (a run is
 * in flight), and `submitted` (already succeeded), returning `false` in
 * those cases (including an unknown id) without touching the row. On
 * success clears `mr_url`/`error`/`report` so a stale value from the
 * previous run can't leak into the next one, and returns `true`.
 */
export function requeueForRetry(db: DatabaseType, id: string, now: string = new Date().toISOString()): boolean {
  const result = db
    .prepare(
      `UPDATE packages
       SET status = 'queued', mr_url = NULL, error = NULL, report = NULL, updated_at = @now
       WHERE id = @id AND status IN ('failed', 'no_changes')`,
    )
    .run({ id, now });
  return result.changes > 0;
}

/**
 * Boot-time recovery sweep: move every package stuck in `processing` (left
 * there by a job runner that crashed mid-run) back to `queued` so it gets
 * picked up again. Returns the ids that were moved.
 */
export function requeueStuckProcessing(db: DatabaseType, now: string = new Date().toISOString()): string[] {
  const rows = db.prepare(`SELECT id FROM packages WHERE status = 'processing'`).all() as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return ids;
  db.prepare(`UPDATE packages SET status = 'queued', updated_at = @now WHERE status = 'processing'`).run({ now });
  return ids;
}

/**
 * ids of every package currently sitting in `queued`, in no particular
 * order. Used by the boot-time queue drain (`lib/packages/queue.ts`'s
 * `bootPackages`), called AFTER `requeueStuckProcessing` so it naturally
 * picks up both packages that were already `queued` before restart and ones
 * just moved there from a crashed `processing` run.
 */
export function listQueuedIds(db: DatabaseType): string[] {
  const rows = db.prepare(`SELECT id FROM packages WHERE status = 'queued'`).all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Delete a package. A no-op if `id` is unknown. */
export function deletePackage(db: DatabaseType, id: string): void {
  db.prepare(`DELETE FROM packages WHERE id = ?`).run(id);
}
