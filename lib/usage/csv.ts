import type { UsageRow } from "./types";

const HEADER = [
  "at",
  "source",
  "owner_email",
  "thread_id",
  "model",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "cost_usd",
  "duration_ms",
  "ok",
  "result_id",
];

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function usageCsv(rows: readonly UsageRow[]): string {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        cell(row.at),
        cell(row.source),
        cell(row.ownerEmail),
        cell(row.threadId),
        cell(row.model),
        cell(row.inputTokens),
        cell(row.outputTokens),
        cell(row.cacheReadTokens),
        cell(row.cacheCreationTokens),
        cell(row.costUsd),
        cell(row.durationMs),
        cell(row.ok ? 1 : 0),
        cell(row.resultId),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
