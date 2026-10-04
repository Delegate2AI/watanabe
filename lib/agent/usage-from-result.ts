import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { UsageEvent, UsageSource } from "@/lib/usage/types";
import { defaultModelId } from "./model-options";

export interface ModelCounters {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export type ModelSnapshot = Record<string, ModelCounters>;

export interface UsageContext {
  source: UsageSource;
  ownerEmail: string | null;
  threadId: string | null;
  fallbackModel?: string;
  at?: string;
}

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const ZERO: ModelCounters = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

function delta(current: ModelCounters, base: ModelCounters): ModelCounters {
  return {
    inputTokens: Math.max(0, current.inputTokens - base.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - base.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - base.cacheReadTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - base.cacheCreationTokens),
    costUsd: Math.max(0, current.costUsd - base.costUsd),
  };
}

function isEmpty(counters: ModelCounters): boolean {
  return (
    counters.inputTokens === 0 &&
    counters.outputTokens === 0 &&
    counters.cacheReadTokens === 0 &&
    counters.cacheCreationTokens === 0 &&
    counters.costUsd === 0
  );
}

export function usageFromResult(
  msg: ResultMessage,
  prev: ModelSnapshot | null,
  ctx: UsageContext,
): { rows: UsageEvent[]; snapshot: ModelSnapshot } {
  const base = {
    resultId: msg.uuid,
    at: ctx.at ?? new Date().toISOString(),
    source: ctx.source,
    ownerEmail: ctx.ownerEmail,
    threadId: ctx.threadId,
    durationMs: msg.duration_ms ?? 0,
    ok: msg.subtype === "success",
  };
  const snapshot: ModelSnapshot = { ...(prev ?? {}) };
  const rows: UsageEvent[] = [];
  const entries: [string, ModelUsage][] = Object.entries(msg.modelUsage ?? {});

  if (entries.length === 0) {
    const usage = msg.usage;
    const model = ctx.fallbackModel ?? defaultModelId();
    const counters: ModelCounters = {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      costUsd: msg.total_cost_usd ?? 0,
    };
    const row = delta(counters, prev?.[model] ?? ZERO);
    snapshot[model] = counters;
    if (!isEmpty(row)) rows.push({ ...base, model, ...row });
    return { rows, snapshot };
  }

  for (const [model, usage] of entries) {
    const counters: ModelCounters = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationInputTokens ?? 0,
      costUsd: usage.costUSD ?? 0,
    };
    const row = delta(counters, prev?.[model] ?? ZERO);
    snapshot[model] = counters;
    if (!isEmpty(row)) rows.push({ ...base, model, ...row });
  }

  return { rows, snapshot };
}
