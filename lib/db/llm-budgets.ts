import type { Database as DatabaseType } from "better-sqlite3";
import type { BudgetRow, LlmPeriod } from "@/lib/llm/types";
import { normalizedEmail } from "@/lib/authority/aliases-store";

interface Row {
  subject_kind: "user" | "team";
  subject: string;
  group_slug: string;
  tokens: number | null;
  period: LlmPeriod;
  allowed: number;
}

type BudgetKey = Pick<BudgetRow, "subjectKind" | "subject" | "groupSlug">;

function normalSubject(kind: BudgetRow["subjectKind"], subject: string): string {
  return kind === "user" ? normalizedEmail(subject) : subject.trim();
}

export function setBudget(
  db: DatabaseType,
  row: BudgetRow & { updatedBy: string },
  now: string = new Date().toISOString(),
): void {
  db.prepare(
    `INSERT INTO llm_budgets (subject_kind, subject, group_slug, tokens, period, allowed, updated_by, updated_at)
     VALUES (@kind, @subject, @group, @tokens, @period, @allowed, @by, @now)
     ON CONFLICT (subject_kind, subject, group_slug) DO UPDATE SET
       tokens = @tokens, period = @period, allowed = @allowed, updated_by = @by, updated_at = @now`,
  ).run({
    kind: row.subjectKind,
    subject: normalSubject(row.subjectKind, row.subject),
    group: row.groupSlug,
    tokens: row.tokens,
    period: row.period,
    allowed: row.allowed ? 1 : 0,
    by: normalizedEmail(row.updatedBy),
    now,
  });
}

export function listBudgets(db: DatabaseType): BudgetRow[] {
  const rows = db
    .prepare(
      `SELECT subject_kind, subject, group_slug, tokens, period, allowed FROM llm_budgets
       ORDER BY subject_kind, subject, group_slug`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    subjectKind: r.subject_kind,
    subject: r.subject,
    groupSlug: r.group_slug,
    tokens: r.tokens,
    period: r.period,
    allowed: r.allowed === 1,
  }));
}

/** Every row for one model group, for when the group itself is deleted. */
export function deleteBudgetsForGroup(db: DatabaseType, groupSlug: string): number {
  return db.prepare(`DELETE FROM llm_budgets WHERE group_slug = @groupSlug`).run({ groupSlug }).changes;
}

export function deleteBudget(db: DatabaseType, key: BudgetKey): boolean {
  return (
    db
      .prepare(`DELETE FROM llm_budgets WHERE subject_kind = @kind AND subject = @subject AND group_slug = @group`)
      .run({ kind: key.subjectKind, subject: normalSubject(key.subjectKind, key.subject), group: key.groupSlug })
      .changes > 0
  );
}
