import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { UsageEvent } from "@/lib/usage/types";

export function recordUsage(db: DatabaseType, events: readonly UsageEvent[]): number {
  if (events.length === 0) return 0;
  const statement = db.prepare(`
    INSERT OR IGNORE INTO usage_events (
      id, result_id, at, source, owner_email, thread_id, model,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, duration_ms, ok
    ) VALUES (
      @id, @resultId, @at, @source, @ownerEmail, @threadId, @model,
      @inputTokens, @outputTokens, @cacheReadTokens, @cacheCreationTokens,
      @costUsd, @durationMs, @ok
    )
  `);
  const writeAll = db.transaction((rows: readonly UsageEvent[]) => {
    let written = 0;
    for (const row of rows) {
      written += statement.run({
        id: randomUUID(),
        resultId: row.resultId,
        at: row.at,
        source: row.source,
        ownerEmail: row.ownerEmail,
        threadId: row.threadId,
        model: row.model,
        inputTokens: Math.round(row.inputTokens),
        outputTokens: Math.round(row.outputTokens),
        cacheReadTokens: Math.round(row.cacheReadTokens),
        cacheCreationTokens: Math.round(row.cacheCreationTokens),
        costUsd: row.costUsd,
        durationMs: Math.round(row.durationMs),
        ok: row.ok ? 1 : 0,
      }).changes;
    }
    return written;
  });
  return writeAll(events);
}
