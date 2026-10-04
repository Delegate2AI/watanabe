import type { Database as DatabaseType } from "better-sqlite3";
import type { Groups } from "@/lib/authority/groups";
import { listBudgets } from "@/lib/db/llm-budgets";
import { listAllLlmKeys } from "@/lib/db/llm-keys";
import { listBudgetRequests } from "@/lib/db/llm-requests";
import { summarizeDailyUsage } from "@/lib/db/llm-usage";
import { createBudgetResolver } from "./snapshot";
import type { AdminRequestView } from "./view-types";

function monthRange(year: number, month: number): [string, string] {
  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return [from, to];
}

/** Everything /admin/llm shows, read once per page load. */
export function loadAdminData(db: DatabaseType, groups: Groups, now: Date = new Date()) {
  const resolver = createBudgetResolver(db, groups, now);
  const labels = new Map(resolver.modelGroups.map((g) => [g.slug, g.label]));
  const current = new Map<string, ReturnType<typeof resolver.budgetsFor>>();
  const budgetFor = (email: string, slug: string) => {
    if (!current.has(email)) current.set(email, resolver.budgetsFor(email));
    return current.get(email)!.find((b) => b.groupSlug === slug);
  };

  const requests: AdminRequestView[] = listBudgetRequests(db).map((r) => {
    const b = budgetFor(r.requesterEmail, r.groupSlug);
    return {
      id: r.id,
      requesterEmail: r.requesterEmail,
      groupSlug: r.groupSlug,
      groupLabel: labels.get(r.groupSlug) ?? r.groupSlug,
      requestedTokens: r.requestedTokens,
      reason: r.reason,
      status: r.status,
      decision: r.decision,
      grantedTokens: r.grantedTokens,
      decidedBy: r.decidedBy,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      used: b?.used ?? 0,
      limit: b ? (b.tokens === null ? null : b.tokens + b.bonus) : null,
      period: b?.period ?? "month",
    };
  });

  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const usageThisMonth = summarizeDailyUsage(db, ...monthRange(y, m));
  const usageLastMonth = summarizeDailyUsage(db, ...monthRange(y, m - 1));

  return {
    requests,
    groups: resolver.modelGroups,
    budgets: listBudgets(db),
    teams: ["all-hands", ...Object.keys(groups).filter((t) => t !== "all-hands").sort()],
    keys: listAllLlmKeys(db),
    usageThisMonth,
    usageLastMonth,
    seenModels: [...new Set([...usageThisMonth, ...usageLastMonth].map((u) => u.model))].sort(),
  };
}
