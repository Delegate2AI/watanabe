import type { Database as DatabaseType } from "better-sqlite3";
import { normalizedEmail } from "@/lib/authority/aliases-store";
import type { UsageDelta } from "@/lib/llm/types";

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  bonusTokens: number;
  requests: number;
}

export interface PeriodUsage extends UsageTotals {
  ownerEmail: string;
  groupSlug: string;
  periodStart: string;
}

/** Only the gate's retry window needs dedupe; older batch ids are dropped. */
const BATCH_RETENTION_MS = 24 * 60 * 60 * 1000;

const ADD_COUNTS = `input_tokens = input_tokens + @input, output_tokens = output_tokens + @output,
  cache_read_tokens = cache_read_tokens + @cacheRead, requests = requests + @requests`;

/**
 * The gate retries a batch whose response it never saw, so a batch id seen
 * before is acknowledged and counted zero times. An empty batch claims nothing:
 * the gate flushes every 5 seconds whether or not anything happened.
 */
export function applyUsageBatch(
  db: DatabaseType,
  batchId: string,
  deltas: UsageDelta[],
  now: string = new Date().toISOString(),
): "applied" | "duplicate" {
  if (deltas.length === 0) return "applied";
  const cutoff = new Date(Date.parse(now) - BATCH_RETENTION_MS).toISOString();
  const prune = db.prepare(`DELETE FROM llm_usage_batches WHERE received_at < @cutoff`);
  const claim = db.prepare(`INSERT OR IGNORE INTO llm_usage_batches (batch_id, received_at) VALUES (@batchId, @now)`);
  const period = db.prepare(
    `INSERT INTO llm_usage (owner_email, group_slug, period_start, input_tokens, output_tokens, cache_read_tokens, requests)
     VALUES (@owner, @group, @periodStart, @input, @output, @cacheRead, @requests)
     ON CONFLICT (owner_email, group_slug, period_start) DO UPDATE SET ${ADD_COUNTS}`,
  );
  const daily = db.prepare(
    `INSERT INTO llm_usage_daily (owner_email, model, day, input_tokens, output_tokens, cache_read_tokens, requests)
     VALUES (@owner, @model, @day, @input, @output, @cacheRead, @requests)
     ON CONFLICT (owner_email, model, day) DO UPDATE SET ${ADD_COUNTS}`,
  );
  return db.transaction(() => {
    prune.run({ cutoff });
    if (claim.run({ batchId, now }).changes === 0) return "duplicate" as const;
    for (const d of deltas) {
      const params = {
        owner: normalizedEmail(d.ownerEmail),
        group: d.groupSlug,
        model: d.model,
        periodStart: d.periodStart,
        day: d.day,
        input: d.inputTokens,
        output: d.outputTokens,
        cacheRead: d.cacheReadTokens,
        requests: d.requests,
      };
      period.run(params);
      daily.run(params);
    }
    return "applied" as const;
  })();
}

const TOTALS = `input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens,
  bonus_tokens AS bonusTokens, requests`;

export function getUsage(db: DatabaseType, ownerEmail: string, groupSlug: string, periodStart: string): UsageTotals {
  const row = db
    .prepare(`SELECT ${TOTALS} FROM llm_usage WHERE owner_email = @owner AND group_slug = @group AND period_start = @periodStart`)
    .get({ owner: normalizedEmail(ownerEmail), group: groupSlug, periodStart }) as UsageTotals | undefined;
  return row ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, bonusTokens: 0, requests: 0 };
}

/** Every usage row whose period starts on one of `periodStarts`: one query for the whole snapshot. */
export function listUsageForPeriods(db: DatabaseType, periodStarts: string[]): PeriodUsage[] {
  if (periodStarts.length === 0) return [];
  const params = Object.fromEntries(periodStarts.map((s, i) => [`s${i}`, s]));
  const placeholders = periodStarts.map((_, i) => `@s${i}`).join(", ");
  return db
    .prepare(
      `SELECT owner_email AS ownerEmail, group_slug AS groupSlug, period_start AS periodStart, ${TOTALS}
       FROM llm_usage WHERE period_start IN (${placeholders})`,
    )
    .all(params) as PeriodUsage[];
}

/** A top-up for one period. It lapses with the period because it lives on that period's row. */
export function addBonusTokens(
  db: DatabaseType,
  ownerEmail: string,
  groupSlug: string,
  periodStart: string,
  tokens: number,
): void {
  db.prepare(
    `INSERT INTO llm_usage (owner_email, group_slug, period_start, bonus_tokens)
     VALUES (@owner, @group, @periodStart, @tokens)
     ON CONFLICT (owner_email, group_slug, period_start) DO UPDATE SET bonus_tokens = bonus_tokens + @tokens`,
  ).run({ owner: normalizedEmail(ownerEmail), group: groupSlug, periodStart, tokens });
}

export interface DailyUsageSummary {
  ownerEmail: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
}

/** Usage per owner and model over `[fromDay, toDay]` inclusive (UTC `YYYY-MM-DD`). */
export function summarizeDailyUsage(db: DatabaseType, fromDay: string, toDay: string): DailyUsageSummary[] {
  return db
    .prepare(
      `SELECT owner_email AS ownerEmail, model, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
              SUM(cache_read_tokens) AS cacheReadTokens, SUM(requests) AS requests
       FROM llm_usage_daily WHERE day >= @fromDay AND day <= @toDay
       GROUP BY owner_email, model ORDER BY owner_email, model`,
    )
    .all({ fromDay, toDay }) as DailyUsageSummary[];
}
