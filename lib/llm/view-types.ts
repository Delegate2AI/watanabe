import type { BudgetDecision, BudgetRequestStatus } from "@/lib/db/llm-requests";
import type { LlmPeriod } from "./types";

/** One model group as the signed-in person sees it on /settings/llm. Serializable, client-safe. */
export interface UserBudgetView {
  groupSlug: string;
  label: string;
  models: string[];
  tokens: number | null;
  period: LlmPeriod;
  resetAt: string;
  used: number;
  bonus: number;
}

export interface AdminRequestView {
  id: string;
  requesterEmail: string;
  groupSlug: string;
  groupLabel: string;
  requestedTokens: number;
  reason: string;
  status: BudgetRequestStatus;
  decision: BudgetDecision | null;
  grantedTokens: number | null;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  /** The requester's current figures in that group, for deciding. */
  used: number;
  limit: number | null;
  period: LlmPeriod;
}
