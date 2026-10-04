import { listOwnerThreads as listOwnerThreadRows, listUsageRows, summarizeUsage as summarizeUsageRows } from "@/lib/db/usage-queries";
import { log } from "@/lib/log";
import type { ServiceContext } from "@/lib/service/actor";
import { err, ok, type ServiceResult } from "@/lib/service/result";
import { usageCsv } from "../csv";
import { isUsageAuditEnabled } from "../config";
import type { OwnerThreadUsage, UsageSummary } from "../types";
import { OwnerThreadsInput, UsagePeriodInput, resolvePeriod } from "./schemas";

type Period = { from: string; to: string };

function gate(ctx: ServiceContext): ServiceResult<null> {
  if (!isUsageAuditEnabled()) return err("not_found");
  if (!ctx.actor.can("manageAccess")) return err("needs_role");
  return ok(null);
}

function period(raw: unknown, label: string): ServiceResult<Period> {
  const parsed = UsagePeriodInput.safeParse(raw ?? {});
  if (!parsed.success) {
    log.info("usage period rejected", { view: label, error: String(parsed.error) });
    return err("invalid_request", { detail: "from" });
  }
  const resolved = resolvePeriod(parsed.data);
  if (resolved.to < resolved.from) return err("invalid_request", { detail: "to" });
  return ok(resolved);
}

export function summarizeUsage(ctx: ServiceContext, raw: unknown): ServiceResult<UsageSummary> {
  const allowed = gate(ctx);
  if (!allowed.ok) return allowed;
  const window = period(raw, "summary");
  if (!window.ok) return window;
  return ok(summarizeUsageRows(ctx.db, window.value));
}

export function listOwnerThreads(
  ctx: ServiceContext,
  raw: unknown,
): ServiceResult<{ owner: string; threads: OwnerThreadUsage[] }> {
  const allowed = gate(ctx);
  if (!allowed.ok) return allowed;
  const parsed = OwnerThreadsInput.safeParse(raw ?? {});
  if (!parsed.success) {
    log.info("usage owner threads rejected", { error: String(parsed.error) });
    return err("invalid_request", { detail: "owner" });
  }
  const window = period(parsed.data, "threads");
  if (!window.ok) return window;
  const owner = parsed.data.owner.trim().toLowerCase();
  return ok({ owner, threads: listOwnerThreadRows(ctx.db, owner, window.value) });
}

export function exportUsage(
  ctx: ServiceContext,
  raw: unknown,
): ServiceResult<{ filename: string; csv: string }> {
  const allowed = gate(ctx);
  if (!allowed.ok) return allowed;
  const window = period(raw, "csv");
  if (!window.ok) return window;
  const rows = listUsageRows(ctx.db, window.value);
  return ok({
    filename: `usage-${window.value.from}-${window.value.to}.csv`,
    csv: usageCsv(rows),
  });
}
