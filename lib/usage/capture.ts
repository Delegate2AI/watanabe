import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { usageFromResult, type ModelSnapshot, type UsageContext } from "@/lib/agent/usage-from-result";
import { getDb } from "@/lib/db/client";
import { getThreadOwner } from "@/lib/db/threads";
import { recordUsage } from "@/lib/db/usage";
import { log } from "@/lib/log";
import { isUsageAuditEnabled } from "./config";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

export function captureUsage(
  msg: ResultMessage,
  ctx: UsageContext,
  prev: ModelSnapshot | null = null,
): ModelSnapshot | null {
  if (!isUsageAuditEnabled()) return prev;
  try {
    const { rows, snapshot } = usageFromResult(msg, prev, ctx);
    if (rows.length > 0) recordUsage(getDb(), rows);
    return snapshot;
  } catch (err) {
    log.error("usage ledger write failed", {
      source: ctx.source,
      threadId: ctx.threadId,
      err: String(err),
    });
    return prev;
  }
}

export function ownerForThread(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  try {
    return getThreadOwner(getDb(), threadId);
  } catch (err) {
    log.error("usage owner lookup failed", { threadId, err: String(err) });
    return null;
  }
}
