import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";
import { normalizedEmail } from "@/lib/authority/aliases-store";

export type BudgetRequestStatus = "pending" | "approved" | "rejected";
export type BudgetDecision = "permanent" | "top_up";

export interface BudgetRequest {
  id: string;
  requesterEmail: string;
  groupSlug: string;
  requestedTokens: number;
  reason: string;
  status: BudgetRequestStatus;
  decision: BudgetDecision | null;
  grantedTokens: number | null;
  decidedBy: string | null;
  decisionNote: string | null;
  taskId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

const COLUMNS = `id, requester_email AS requesterEmail, group_slug AS groupSlug, requested_tokens AS requestedTokens,
  reason, status, decision, granted_tokens AS grantedTokens, decided_by AS decidedBy, decision_note AS decisionNote,
  task_id AS taskId, created_at AS createdAt, decided_at AS decidedAt`;

export function createBudgetRequest(
  db: DatabaseType,
  input: { requesterEmail: string; groupSlug: string; requestedTokens: number; reason: string },
  now: string = new Date().toISOString(),
): BudgetRequest {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO llm_budget_requests (id, requester_email, group_slug, requested_tokens, reason, status, created_at)
     VALUES (@id, @requester, @group, @tokens, @reason, 'pending', @now)`,
  ).run({
    id,
    requester: normalizedEmail(input.requesterEmail),
    group: input.groupSlug,
    tokens: input.requestedTokens,
    reason: input.reason.trim(),
    now,
  });
  return getBudgetRequest(db, id)!;
}

export function getBudgetRequest(db: DatabaseType, id: string): BudgetRequest | null {
  return (db.prepare(`SELECT ${COLUMNS} FROM llm_budget_requests WHERE id = @id`).get({ id }) as BudgetRequest) ?? null;
}

/** Pending first, then newest. */
export function listBudgetRequests(db: DatabaseType, filter: { requesterEmail?: string } = {}): BudgetRequest[] {
  const where = filter.requesterEmail ? `WHERE requester_email = @requester` : "";
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM llm_budget_requests ${where}
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .all(filter.requesterEmail ? { requester: normalizedEmail(filter.requesterEmail) } : {}) as BudgetRequest[];
}

/** Null when the request does not exist or was already decided: a decision is made once. */
export function decideBudgetRequest(
  db: DatabaseType,
  id: string,
  input: {
    status: "approved" | "rejected";
    decision?: BudgetDecision;
    grantedTokens?: number;
    decidedBy: string;
    note?: string;
  },
  now: string = new Date().toISOString(),
): BudgetRequest | null {
  const info = db
    .prepare(
      `UPDATE llm_budget_requests SET status = @status, decision = @decision, granted_tokens = @granted,
         decided_by = @by, decision_note = @note, decided_at = @now
       WHERE id = @id AND status = 'pending'`,
    )
    .run({
      id,
      status: input.status,
      decision: input.decision ?? null,
      granted: input.grantedTokens ?? null,
      by: normalizedEmail(input.decidedBy),
      note: input.note?.trim() || null,
      now,
    });
  return info.changes > 0 ? getBudgetRequest(db, id) : null;
}

export function setBudgetRequestTask(db: DatabaseType, id: string, taskId: string): void {
  db.prepare(`UPDATE llm_budget_requests SET task_id = @taskId WHERE id = @id`).run({ id, taskId });
}
