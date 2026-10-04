export const LLM_PERIODS = ["day", "week", "month"] as const;
export type LlmPeriod = (typeof LLM_PERIODS)[number];

export interface ModelGroup {
  slug: string;
  label: string;
  models: string[];
  defaultTokens: number | null;
  period: LlmPeriod;
}

export interface BudgetRow {
  subjectKind: "user" | "team";
  subject: string;
  groupSlug: string;
  tokens: number | null;
  period: LlmPeriod;
  allowed: boolean;
}

export interface ResolvedBudget {
  groupSlug: string;
  allowed: boolean;
  tokens: number | null;
  period: LlmPeriod;
  source: "user" | "team" | "default";
}

export interface UsageDelta {
  ownerEmail: string;
  groupSlug: string;
  model: string;
  periodStart: string;
  day: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
}

export interface SnapshotBudget {
  ownerEmail: string;
  groupSlug: string;
  allowed: boolean;
  tokens: number | null;
  period: LlmPeriod;
  periodStart: string;
  resetAt: string;
  used: number;
  bonus: number;
}

export interface GateSnapshot {
  generatedAt: string;
  keys: Array<{ id: string; hash: string; ownerEmail: string }>;
  groups: Array<{ slug: string; models: string[] }>;
  budgets: SnapshotBudget[];
}
