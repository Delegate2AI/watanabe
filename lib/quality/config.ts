import { isFlagEnabled } from "@/lib/config/flags";

/** Config for the quality gates subsystem. Gates on its own flag, independent of others. */
export function isQualityGatesEnabled(): boolean {
  return isFlagEnabled("QUALITY_GATES_ENABLED");
}

/**
 * Config for the integrity-check agent. Compound: also requires quality
 * gates to be on, since it hooks into the same kb_submit orchestration.
 */
export function isIntegrityEnabled(): boolean {
  return isFlagEnabled("INTEGRITY_ENABLED") && isQualityGatesEnabled();
}
