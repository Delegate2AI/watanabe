import type { BudgetRow, LlmPeriod, ModelGroup, ResolvedBudget } from "./types";

const PERIOD_DAYS: Record<LlmPeriod, number> = { day: 1, week: 7, month: 30 };

/** Positive when `a` is more generous than `b` (plan decision A1). */
function generosity(a: BudgetRow, b: BudgetRow): number {
  if (a.allowed !== b.allowed) return a.allowed ? 1 : -1;
  if (a.tokens === null || b.tokens === null) {
    if (a.tokens === b.tokens) return PERIOD_DAYS[a.period] - PERIOD_DAYS[b.period];
    return a.tokens === null ? 1 : -1;
  }
  const rate = a.tokens / PERIOD_DAYS[a.period] - b.tokens / PERIOD_DAYS[b.period];
  if (rate !== 0) return rate;
  return PERIOD_DAYS[a.period] - PERIOD_DAYS[b.period];
}

function fromRow(row: BudgetRow, source: "user" | "team"): ResolvedBudget {
  return { groupSlug: row.groupSlug, allowed: row.allowed, tokens: row.tokens, period: row.period, source };
}

export function resolveBudget(input: {
  email: string;
  teams: string[];
  group: ModelGroup;
  budgets: BudgetRow[];
}): ResolvedBudget {
  const email = input.email.trim().toLowerCase();
  const forGroup = input.budgets.filter((b) => b.groupSlug === input.group.slug);

  const user = forGroup.find((b) => b.subjectKind === "user" && b.subject.toLowerCase() === email);
  if (user) return fromRow(user, "user");

  const teams = new Set(input.teams);
  const teamRows = forGroup.filter((b) => b.subjectKind === "team" && teams.has(b.subject));
  if (teamRows.length > 0) {
    const best = teamRows.reduce((acc, b) => (generosity(b, acc) > 0 ? b : acc));
    return fromRow(best, "team");
  }

  return {
    groupSlug: input.group.slug,
    allowed: true,
    tokens: input.group.defaultTokens,
    period: input.group.period,
    source: "default",
  };
}
