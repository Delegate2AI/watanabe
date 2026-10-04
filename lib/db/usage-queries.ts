import type { Database as DatabaseType } from "better-sqlite3";
import { utcDayWindow } from "@/lib/usage/window";
import type {
  ModelUsageTotals,
  OwnerThreadUsage,
  OwnerUsage,
  SourceUsage,
  UsageRow,
  UsageSource,
  UsageSummary,
  UsageTotals,
} from "@/lib/usage/types";

export const USAGE_EXPORT_LIMIT = 50000;

const TOTALS = `
  COUNT(DISTINCT result_id) AS turns,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(cost_usd), 0) AS cost_usd
`;

interface TotalsRow {
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
}

function totals(row: TotalsRow | undefined): UsageTotals {
  return {
    turns: row?.turns ?? 0,
    inputTokens: row?.input_tokens ?? 0,
    outputTokens: row?.output_tokens ?? 0,
    cacheReadTokens: row?.cache_read_tokens ?? 0,
    cacheCreationTokens: row?.cache_creation_tokens ?? 0,
    costUsd: row?.cost_usd ?? 0,
  };
}

function add(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    turns: left.turns + right.turns,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function topModels(db: DatabaseType, window: { fromTs: string; toTs: string }): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT owner_email, model, SUM(cost_usd) AS cost_usd
       FROM usage_events
       WHERE at >= @fromTs AND at < @toTs AND owner_email IS NOT NULL
       GROUP BY owner_email, model
       ORDER BY SUM(cost_usd) DESC`,
    )
    .all(window) as { owner_email: string; model: string }[];
  const best = new Map<string, string>();
  for (const row of rows) if (!best.has(row.owner_email)) best.set(row.owner_email, row.model);
  return best;
}

export function summarizeUsage(db: DatabaseType, period: { from: string; to: string }): UsageSummary {
  const window = utcDayWindow(period.from, period.to);
  const users = totals(
    db
      .prepare(`SELECT ${TOTALS} FROM usage_events WHERE at >= @fromTs AND at < @toTs AND owner_email IS NOT NULL`)
      .get(window) as TotalsRow | undefined,
  );
  const system = totals(
    db
      .prepare(`SELECT ${TOTALS} FROM usage_events WHERE at >= @fromTs AND at < @toTs AND owner_email IS NULL`)
      .get(window) as TotalsRow | undefined,
  );
  const best = topModels(db, window);
  const ownerRows = db
    .prepare(
      `SELECT owner_email, ${TOTALS} FROM usage_events
       WHERE at >= @fromTs AND at < @toTs AND owner_email IS NOT NULL
       GROUP BY owner_email ORDER BY SUM(cost_usd) DESC`,
    )
    .all(window) as (TotalsRow & { owner_email: string })[];
  const sourceRows = db
    .prepare(
      `SELECT source, ${TOTALS} FROM usage_events
       WHERE at >= @fromTs AND at < @toTs AND owner_email IS NULL
       GROUP BY source ORDER BY SUM(cost_usd) DESC`,
    )
    .all(window) as (TotalsRow & { source: UsageSource })[];
  const modelRows = db
    .prepare(
      `SELECT model, ${TOTALS} FROM usage_events
       WHERE at >= @fromTs AND at < @toTs
       GROUP BY model ORDER BY SUM(cost_usd) DESC`,
    )
    .all(window) as (TotalsRow & { model: string })[];

  const owners: OwnerUsage[] = ownerRows.map((row) => ({
    ownerEmail: row.owner_email,
    topModel: best.get(row.owner_email) ?? null,
    ...totals(row),
  }));
  const sources: SourceUsage[] = sourceRows.map((row) => ({ source: row.source, ...totals(row) }));
  const models: ModelUsageTotals[] = modelRows.map((row) => ({ model: row.model, ...totals(row) }));

  return { from: period.from, to: period.to, users, system, grand: add(users, system), owners, sources, models };
}

export function listOwnerThreads(
  db: DatabaseType,
  ownerEmail: string,
  period: { from: string; to: string },
): OwnerThreadUsage[] {
  const window = utcDayWindow(period.from, period.to);
  const rows = db
    .prepare(
      `SELECT u.thread_id AS thread_id, u.source AS source, t.title AS title,
              COUNT(DISTINCT u.result_id) AS turns,
              COALESCE(SUM(u.cost_usd), 0) AS cost_usd,
              MAX(u.at) AS last_at
       FROM usage_events u
       LEFT JOIN threads t ON t.sdk_session_id = u.thread_id
       WHERE u.owner_email = @ownerEmail AND u.at >= @fromTs AND u.at < @toTs AND u.thread_id IS NOT NULL
       GROUP BY u.thread_id, u.source
       ORDER BY SUM(u.cost_usd) DESC, MAX(u.at) DESC`,
    )
    .all({ ...window, ownerEmail }) as {
    thread_id: string;
    source: UsageSource;
    title: string | null;
    turns: number;
    cost_usd: number;
    last_at: string;
  }[];
  return rows.map((row) => ({
    threadId: row.thread_id,
    source: row.source,
    title: row.title,
    turns: row.turns,
    costUsd: row.cost_usd,
    lastAt: row.last_at,
  }));
}

export function listUsageRows(
  db: DatabaseType,
  period: { from: string; to: string },
  limit: number = USAGE_EXPORT_LIMIT,
): UsageRow[] {
  const window = utcDayWindow(period.from, period.to);
  const rows = db
    .prepare(
      `SELECT * FROM usage_events
       WHERE at >= @fromTs AND at < @toTs
       ORDER BY at ASC, result_id ASC, model ASC
       LIMIT @limit`,
    )
    .all({ ...window, limit }) as Record<string, string | number | null>[];
  return rows.map((row) => ({
    id: String(row.id),
    resultId: String(row.result_id),
    at: String(row.at),
    source: row.source as UsageSource,
    ownerEmail: row.owner_email === null ? null : String(row.owner_email),
    threadId: row.thread_id === null ? null : String(row.thread_id),
    model: String(row.model),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheCreationTokens: Number(row.cache_creation_tokens),
    costUsd: Number(row.cost_usd),
    durationMs: Number(row.duration_ms),
    ok: Number(row.ok) === 1,
  }));
}
