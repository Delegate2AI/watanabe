import type { Database as DatabaseType } from "better-sqlite3";
import { z } from "zod";
import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import type { Groups } from "@/lib/authority/groups";
import { deleteBudget, deleteBudgetsForGroup, setBudget } from "@/lib/db/llm-budgets";
import { deleteModelGroup, listModelGroups, upsertModelGroup } from "@/lib/db/llm-groups";
import { listLlmKeys } from "@/lib/db/llm-keys";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { notifyGate } from "./gate-client";
import { revokeLlmKeyFor } from "./keys";
import type { RouterAdmin } from "./router-admin";
import { LLM_PERIODS } from "./types";

export interface AdminCtx {
  db: DatabaseType;
  actorEmail: string;
  groups: Groups;
  admin?: RouterAdmin | null;
  notify?: () => Promise<void>;
}

const tokens = z.number().int().nonnegative().max(1e12).nullable();

const GroupInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  models: z.array(z.string().trim().min(1).max(200)).max(50),
  defaultTokens: tokens,
  period: z.enum(LLM_PERIODS),
});

const BudgetKey = z.object({
  subjectKind: z.enum(["user", "team"]),
  subject: z.string().trim().min(1).max(200),
  groupSlug: z.string().min(1),
});
const BudgetInput = BudgetKey.extend({ tokens, period: z.enum(LLM_PERIODS), allowed: z.boolean() });

async function changed(ctx: AdminCtx): Promise<void> {
  await (ctx.notify ?? notifyGate)();
}

/** A team must exist in groups.yaml (or be the implicit all-hands); a user is stored by canonical address. */
function subjectFor(ctx: AdminCtx, kind: "user" | "team", subject: string): string | null {
  if (kind === "user") return subject.includes("@") ? canonicalEmail(subject, aliasIndex()) : null;
  return subject === "all-hands" || subject in ctx.groups ? subject : null;
}

export async function saveModelGroup(ctx: AdminCtx, raw: unknown): Promise<ServiceResult<null>> {
  const parsed = GroupInput.safeParse(raw);
  if (!parsed.success) return err("invalid_request", { detail: parsed.error.issues[0]?.path.join(".") });
  upsertModelGroup(ctx.db, parsed.data);
  await changed(ctx);
  return ok(null);
}

/** Its budget rows go with it; they could never apply again. */
export async function removeModelGroup(ctx: AdminCtx, slug: string): Promise<ServiceResult<null>> {
  const removed = ctx.db.transaction(() => {
    deleteBudgetsForGroup(ctx.db, slug);
    return deleteModelGroup(ctx.db, slug);
  })();
  if (!removed) return err("not_found");
  await changed(ctx);
  return ok(null);
}

export async function saveBudget(ctx: AdminCtx, raw: unknown): Promise<ServiceResult<null>> {
  const parsed = BudgetInput.safeParse(raw);
  if (!parsed.success) return err("invalid_request", { detail: parsed.error.issues[0]?.path.join(".") });
  if (!listModelGroups(ctx.db).some((g) => g.slug === parsed.data.groupSlug)) {
    return err("invalid_request", { detail: "groupSlug" });
  }
  const subject = subjectFor(ctx, parsed.data.subjectKind, parsed.data.subject);
  if (!subject) return err("invalid_request", { detail: "subject" });
  setBudget(ctx.db, { ...parsed.data, subject, updatedBy: ctx.actorEmail });
  await changed(ctx);
  return ok(null);
}

export async function removeBudget(ctx: AdminCtx, raw: unknown): Promise<ServiceResult<null>> {
  const parsed = BudgetKey.safeParse(raw);
  if (!parsed.success) return err("invalid_request");
  const subject = subjectFor(ctx, parsed.data.subjectKind, parsed.data.subject) ?? parsed.data.subject;
  if (!deleteBudget(ctx.db, { ...parsed.data, subject })) return err("not_found");
  await changed(ctx);
  return ok(null);
}

/** For leavers: every active key of one person, revoked in one action. */
export async function revokeAllKeys(ctx: AdminCtx, ownerEmail: string): Promise<ServiceResult<{ revoked: number }>> {
  const owner = canonicalEmail(ownerEmail, aliasIndex());
  const active = listLlmKeys(ctx.db, owner).filter((k) => k.status === "active");
  const deps = { db: ctx.db, admin: ctx.admin ?? null, notify: async () => undefined };
  let revoked = 0;
  for (const key of active) {
    if ((await revokeLlmKeyFor(deps, { id: key.id, ownerEmail: null })).ok) revoked++;
  }
  if (revoked > 0) await changed(ctx);
  return ok({ revoked });
}
