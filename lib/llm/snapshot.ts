import type { Database as DatabaseType } from "better-sqlite3";
import { aliasIndex } from "@/lib/authority/aliases";
import { resolveClearance, type Groups } from "@/lib/authority/groups";
import { listBudgets } from "@/lib/db/llm-budgets";
import { listModelGroups } from "@/lib/db/llm-groups";
import { listActiveKeyHashes } from "@/lib/db/llm-keys";
import { listUsageForPeriods } from "@/lib/db/llm-usage";
import { periodBounds } from "./period";
import { resolveBudget } from "./resolve";
import {
  LLM_PERIODS, type BudgetRow, type GateSnapshot, type LlmPeriod, type ModelGroup, type SnapshotBudget,
} from "./types";

export interface BudgetResolver {
  modelGroups: ModelGroup[];
  /** One resolved budget per model group, with this period's usage. */
  budgetsFor(ownerEmail: string): SnapshotBudget[];
}

/**
 * Reads everything once (usage for the three current period starts in one
 * query, the alias registry once) and resolves budgets per owner from memory.
 * The gate's snapshot and the user's own page both use it, so they cannot
 * disagree about what someone has left. Cache reads never count.
 */
export function createBudgetResolver(db: DatabaseType, groups: Groups, now: Date = new Date()): BudgetResolver {
  const modelGroups = listModelGroups(db);
  const bounds = Object.fromEntries(LLM_PERIODS.map((p) => [p, periodBounds(p, now)])) as Record<
    LlmPeriod,
    { start: string; resetAt: string }
  >;
  const usage = new Map(
    listUsageForPeriods(db, [...new Set(Object.values(bounds).map((b) => b.start))]).map((u) => [
      `${u.ownerEmail}|${u.groupSlug}|${u.periodStart}`,
      u,
    ]),
  );
  const budgetsByGroup = new Map<string, BudgetRow[]>();
  for (const row of listBudgets(db)) {
    budgetsByGroup.set(row.groupSlug, [...(budgetsByGroup.get(row.groupSlug) ?? []), row]);
  }
  const aliases = aliasIndex();

  return {
    modelGroups,
    budgetsFor(ownerEmail) {
      const teams = resolveClearance(ownerEmail, groups, aliases);
      return modelGroups.map((group) => {
        const resolved = resolveBudget({ email: ownerEmail, teams, group, budgets: budgetsByGroup.get(group.slug) ?? [] });
        const { start, resetAt } = bounds[resolved.period];
        const used = usage.get(`${ownerEmail}|${group.slug}|${start}`);
        return {
          ownerEmail,
          groupSlug: group.slug,
          allowed: resolved.allowed,
          tokens: resolved.tokens,
          period: resolved.period,
          periodStart: start,
          resetAt,
          used: (used?.inputTokens ?? 0) + (used?.outputTokens ?? 0),
          bonus: used?.bonusTokens ?? 0,
        };
      });
    },
  };
}

/** Everything the gate needs to decide a request without calling back. Built every 30 seconds. */
export function buildSnapshot(db: DatabaseType, groups: Groups, now: Date = new Date()): GateSnapshot {
  const keys = listActiveKeyHashes(db);
  const resolver = createBudgetResolver(db, groups, now);
  const owners = [...new Set(keys.map((k) => k.ownerEmail))].sort();
  return {
    generatedAt: now.toISOString(),
    keys,
    groups: resolver.modelGroups.map((g) => ({ slug: g.slug, models: g.models })),
    budgets: owners.flatMap((owner) => resolver.budgetsFor(owner)),
  };
}
