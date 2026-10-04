import { isFlagEnabled } from "@/lib/config/flags";
import { can, isRolesEnabled } from "./roles";

/**
 * The single source of truth for whether the write path (staging edits and
 * submitting them as a commit/MR) is switched on. Checked by the authoritative
 * gate (`lib/agent/permissions.ts`) AND at tool-registration time in
 * `lib/kb-mcp/server.ts`, which only registers the five write tools when this
 * is true. That is deliberate belt-and-suspenders: registration is the primary
 * control (the model cannot even see a tool that is not registered), the gate's
 * re-check is the backstop if the two ever drift.
 */
export function isKbWriteEnabled(): boolean {
  return isFlagEnabled("KB_WRITE_ENABLED");
}

export function effectiveCanWrite(email: string): boolean {
  return isKbWriteEnabled() && (!isRolesEnabled() || can(email, "write"));
}
