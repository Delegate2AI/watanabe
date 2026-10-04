import type { Database as DatabaseType } from "better-sqlite3";

export type JobStatus = "processing" | "succeeded" | "failed";

export type JobRun = {
  id: number;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: JobStatus;
  detail: string | null;
};

type RunRow = {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: JobStatus;
  detail: string | null;
};

const initialized = new WeakSet<DatabaseType>();

export function ensureJobSchema(db: DatabaseType): void {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_runs (
      job TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('processing','succeeded','failed')),
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs (status);
    CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs (job, started_at DESC);
    CREATE TABLE IF NOT EXISTS job_cursors (
      job TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  initialized.add(db);
}

export function recordStart(db: DatabaseType, job: string, startedAt = new Date().toISOString()): number {
  ensureJobSchema(db);
  const result = db.prepare(`
    INSERT INTO job_runs (job, started_at, finished_at, status, detail)
    VALUES (@job, @startedAt, NULL, 'processing', NULL)
  `).run({ job, startedAt });
  return Number(result.lastInsertRowid);
}

export function recordFinish(
  db: DatabaseType,
  id: number,
  status: Exclude<JobStatus, "processing">,
  detail: string | null,
  finishedAt = new Date().toISOString(),
): void {
  ensureJobSchema(db);
  db.prepare(`
    UPDATE job_runs SET finished_at = @finishedAt, status = @status, detail = @detail
    WHERE rowid = @id
  `).run({ id, status, detail, finishedAt });
}

export function hasProcessingRun(db: DatabaseType, job: string): boolean {
  ensureJobSchema(db);
  const row = db.prepare(`
    SELECT 1 FROM job_runs WHERE job = @job AND status = 'processing' LIMIT 1
  `).get({ job });
  return row !== undefined;
}

export function listProcessingJobs(db: DatabaseType): string[] {
  ensureJobSchema(db);
  const rows = db.prepare(`
    SELECT DISTINCT job FROM job_runs WHERE status = 'processing' ORDER BY job
  `).all() as Array<{ job: string }>;
  return rows.map((row) => row.job);
}

export function listProcessingRuns(db: DatabaseType): JobRun[] {
  ensureJobSchema(db);
  const rows = db.prepare(`
    SELECT rowid AS id, job, started_at, finished_at, status, detail
    FROM job_runs WHERE status = 'processing' ORDER BY rowid
  `).all() as RunRow[];
  return rows.map(mapRun);
}

export function getLatestRun(db: DatabaseType, job: string): JobRun | null {
  ensureJobSchema(db);
  const row = db.prepare(`
    SELECT rowid AS id, job, started_at, finished_at, status, detail
    FROM job_runs WHERE job = @job ORDER BY rowid DESC LIMIT 1
  `).get({ job }) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function getCursor(db: DatabaseType, job: string): string | null {
  ensureJobSchema(db);
  const row = db.prepare("SELECT value FROM job_cursors WHERE job = @job").get({ job }) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setCursor(db: DatabaseType, job: string, value: string): void {
  ensureJobSchema(db);
  db.prepare(`
    INSERT INTO job_cursors (job, value) VALUES (@job, @value)
    ON CONFLICT(job) DO UPDATE SET value = excluded.value
  `).run({ job, value });
}

function mapRun(row: RunRow): JobRun {
  return {
    id: row.id,
    job: row.job,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    detail: row.detail,
  };
}
