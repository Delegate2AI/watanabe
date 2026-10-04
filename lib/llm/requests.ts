import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "crypto";
import { normalizedEmail } from "@/lib/authority/aliases-store";
import type { Groups } from "@/lib/authority/groups";
import { can, isPortalBot, loadRoles } from "@/lib/authority/roles";
import { setBudget } from "@/lib/db/llm-budgets";
import { listModelGroups } from "@/lib/db/llm-groups";
import {
  createBudgetRequest, decideBudgetRequest, getBudgetRequest, setBudgetRequestTask, type BudgetRequest,
} from "@/lib/db/llm-requests";
import { addBonusTokens } from "@/lib/db/llm-usage";
import { addComment } from "@/lib/db/task-comments";
import { createManualTask, setStatus } from "@/lib/db/tasks";
import { log } from "@/lib/log";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { notifyGate } from "./gate-client";
import { createBudgetResolver } from "./snapshot";

export interface RequestCtx {
  db: DatabaseType;
  groups: Groups;
  now?: () => Date;
  notify?: () => Promise<void>;
  /** Who decides budget requests; defaults to every manageAccess holder. */
  approvers?: () => string[];
}

const MAX_TOKENS = 1e12;
const fmt = (n: number) => n.toLocaleString("en-US");

/** Everyone who can decide a request: roles.yaml admins plus bootstrap admins, never the portal bot. */
export function manageAccessHolders(): string[] {
  const candidates = [
    ...(loadRoles().admin ?? []),
    ...(process.env.BOOTSTRAP_ADMINS ?? "").split(","),
  ].map(normalizedEmail);
  return [...new Set(candidates)].filter((e) => e.includes("@") && !isPortalBot(e) && can(e, "manageAccess")).sort();
}

/** Admin-only when groups.yaml has an `admins` group; otherwise the board of everyone, as a manual task would be. */
function requestClearance(groups: Groups): string[] {
  return "admins" in groups ? ["admins"] : ["all-hands"];
}

/**
 * A person asks for more tokens in one model group. The request row is the
 * source of truth; the task only puts it in front of the admins (spec: budget
 * requests through tasks). Closing the task without a decision leaves the
 * request pending.
 */
export function requestMoreTokens(
  ctx: RequestCtx,
  input: { requesterEmail: string; groupSlug: string; tokens: unknown; reason: unknown },
): ServiceResult<BudgetRequest> {
  const group = listModelGroups(ctx.db).find((g) => g.slug === input.groupSlug);
  if (!group) return err("invalid_request", { detail: "groupSlug" });
  const tokens = input.tokens;
  if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 1 || tokens > MAX_TOKENS) {
    return err("invalid_request", { detail: "tokens" });
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > 500) return err("invalid_request", { detail: "reason" });

  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const requester = normalizedEmail(input.requesterEmail);
  const request = ctx.db.transaction(() => {
    const created = createBudgetRequest(ctx.db, { requesterEmail: requester, groupSlug: group.slug, requestedTokens: tokens, reason }, now);
    const task = createManualTask(ctx.db, {
      title: `LLM budget: ${requester} wants +${fmt(tokens)} tokens for ${group.label}`,
      description: `${reason}\n\nDecide in Administration > LLM keys: /admin/llm#requests (request ${created.id}).`,
      assignees: (ctx.approvers ?? manageAccessHolders)(),
      clearance: requestClearance(ctx.groups),
      due: null,
      createdBy: requester,
      createdAt: now,
    });
    setBudgetRequestTask(ctx.db, created.id, task.id);
    return { ...created, taskId: task.id };
  })();
  return ok(request);
}

export type DecisionAction = "approve_permanent" | "approve_top_up" | "reject";

/**
 * Applies an admin's decision. A permanent raise writes a `user` budget row at
 * the person's current limit plus the granted amount, in their current period;
 * a top-up adds bonus tokens to the current period only. Either way the outcome
 * is posted on the task and the task is completed.
 */
export async function decideRequest(
  ctx: RequestCtx,
  input: { id: string; actorEmail: string; action: unknown; tokens?: unknown; note?: unknown },
): Promise<ServiceResult<BudgetRequest>> {
  const request = getBudgetRequest(ctx.db, input.id);
  if (!request) return err("not_found");
  if (request.status !== "pending") return err("conflict");
  const action = input.action;
  if (action !== "approve_permanent" && action !== "approve_top_up" && action !== "reject") {
    return err("invalid_request", { detail: "action" });
  }
  const granted = input.tokens === undefined ? request.requestedTokens : input.tokens;
  if (action !== "reject" && (typeof granted !== "number" || !Number.isInteger(granted) || granted < 1 || granted > MAX_TOKENS)) {
    return err("invalid_request", { detail: "tokens" });
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  const nowDate = (ctx.now ?? (() => new Date()))();
  const now = nowDate.toISOString();
  const actor = normalizedEmail(input.actorEmail);

  // Resolved before the transaction so a deleted group is an answer, not a rollback.
  const current =
    action === "reject"
      ? undefined
      : createBudgetResolver(ctx.db, ctx.groups, nowDate)
          .budgetsFor(request.requesterEmail)
          .find((b) => b.groupSlug === request.groupSlug);
  if (action !== "reject" && !current) return err("not_found");

  const decided = ctx.db.transaction(() => {
    // Claim the request first: if someone else decided it in the meantime,
    // nothing below runs and no grant is applied twice.
    const row = decideBudgetRequest(ctx.db, request.id, {
      status: action === "reject" ? "rejected" : "approved",
      decision: action === "approve_permanent" ? "permanent" : action === "approve_top_up" ? "top_up" : undefined,
      grantedTokens: action === "reject" ? undefined : (granted as number),
      decidedBy: actor,
      note,
    }, now);
    if (!row) return null;

    let outcome: string;
    const amount = granted as number;
    if (action === "reject" || !current) {
      outcome = `Rejected by ${actor}.`;
    } else if (action === "approve_top_up") {
      addBonusTokens(ctx.db, request.requesterEmail, request.groupSlug, current.periodStart, amount);
      outcome = `Approved by ${actor}: +${fmt(amount)} tokens for this ${current.period} (until ${current.resetAt}).`;
    } else if (current.tokens === null) {
      outcome = `Approved by ${actor}: already unlimited, nothing to raise.`;
    } else {
      setBudget(ctx.db, {
        subjectKind: "user", subject: request.requesterEmail, groupSlug: request.groupSlug,
        tokens: current.tokens + amount, period: current.period, allowed: true, updatedBy: actor,
      }, now);
      outcome = `Approved by ${actor}: limit raised to ${fmt(current.tokens + amount)} tokens per ${current.period}.`;
    }
    if (row.taskId) {
      addComment(ctx.db, { id: randomUUID(), taskId: row.taskId, authorEmail: actor, body: note ? `${outcome}\n\n${note}` : outcome, createdAt: now });
      setStatus(ctx.db, row.taskId, "done", undefined, undefined, now);
    }
    return row;
  })();
  if (!decided) return err("conflict");
  try {
    await (ctx.notify ?? notifyGate)();
  } catch (e) {
    log.warn("llm gate notify after a budget decision failed", { error: (e as Error).message });
  }
  return ok(decided);
}
