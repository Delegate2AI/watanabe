import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { isDocGroupSharingEnabled } from "./config";

/**
 * The clearance to resolve one principal's TEAM share rows with.
 *
 * Every shared-doc surface that asks "what can this person reach?" goes through
 * here rather than calling `resolveClearanceForEmail` directly, so the feature
 * flag has exactly one door and no surface can drift into resolving group grants
 * while another does not. That drift is the dangerous kind: the document list
 * and the document itself disagreeing produces a row you can see and cannot
 * open, or the reverse.
 *
 * Flag-off returns `[]`, which every consumer already treats as "user rows
 * only". So the fall-back is the original byte-path, and the failure direction
 * is closed: a caller that forgets to pass clearance under-grants.
 *
 * This is NOT a clearance check. Nothing downstream grants access for holding a
 * group; the group only decides which explicit `doc_shares` rows are addressed
 * to this reader. See the invariant in `./access.ts`.
 */
export function shareClearanceFor(email: string): string[] {
  if (!isDocGroupSharingEnabled()) return [];
  return resolveClearanceForEmail(email);
}
