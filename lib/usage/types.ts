export const USAGE_SOURCES = ["chat", "dream", "quality", "meetings", "packages", "design", "content"] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

export interface UsageEvent {
  resultId: string;
  at: string;
  source: UsageSource;
  ownerEmail: string | null;
  threadId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  ok: boolean;
}

export interface UsageRow extends UsageEvent {
  id: string;
}

export interface UsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface OwnerUsage extends UsageTotals {
  ownerEmail: string;
  topModel: string | null;
}

export interface SourceUsage extends UsageTotals {
  source: UsageSource;
}

export interface ModelUsageTotals extends UsageTotals {
  model: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  users: UsageTotals;
  system: UsageTotals;
  grand: UsageTotals;
  owners: OwnerUsage[];
  sources: SourceUsage[];
  models: ModelUsageTotals[];
}

export interface OwnerThreadUsage {
  threadId: string;
  source: UsageSource;
  title: string | null;
  turns: number;
  costUsd: number;
  lastAt: string;
}
