import { isFlagEnabled } from "@/lib/config/flags";

export function isUsageAuditEnabled(): boolean {
  return isFlagEnabled("USAGE_AUDIT_ENABLED");
}
