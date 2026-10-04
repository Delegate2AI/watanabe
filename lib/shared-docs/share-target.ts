import { isAdmin, loadGroups } from "@/lib/authority/groups";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { ALL_HANDS, unknownGroups } from "@/lib/authority/group-keys";
import { isDocGroupSharingEnabled } from "./config";
import type { ShareRecipientKind } from "./types";

/**
 * Validation for who a document may be handed to, shared by the share route and
 * the picker that feeds it.
 *
 * The person case is unchanged from spec 28: any address, except the owner's own
 * (they already hold every capability, so a self-share only ever produced a
 * redundant row and mailed them their own "what's new").
 *
 * The team case is new and is the one with teeth, because a group key is not
 * self-describing the way an email is. Two ways it can go wrong, both silent:
 *
 *  - A key `groups.yaml` does not declare writes a healthy-looking row that no
 *    resolver will ever match, and which starts granting the day somebody
 *    happens to create a group by that name. `unknownGroups` is the repo's
 *    shared guard against exactly that, and it already treats the implicit
 *    `all-hands` as known (it is never declared but always resolves).
 *  - A key the sharer is not cleared for turns the share box into a membership
 *    oracle, and lets someone grant access to a team they cannot see. So the
 *    target must be in the sharer's own clearance, which is also precisely what
 *    the picker offers. Admins are exempt on the same reasoning as
 *    `visibilityOptionsFor`: they already read and administer every group, so
 *    scoping them hides nothing and only blocks filing a doc where it belongs.
 */

export type ShareTargetRejection =
  | "group_sharing_off"
  | "unknown_group"
  | "group_not_in_clearance"
  | "self";

export type ShareTargetResult = { ok: true } | { ok: false; reason: ShareTargetRejection };

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function validateShareTarget(
  target: { recipient: string; kind: ShareRecipientKind },
  sharerEmail: string,
): ShareTargetResult {
  if (target.kind === "user") {
    if (sameAddress(target.recipient, sharerEmail)) return { ok: false, reason: "self" };
    return { ok: true };
  }

  if (!isDocGroupSharingEnabled()) return { ok: false, reason: "group_sharing_off" };
  const group = target.recipient.trim();
  if (unknownGroups([group]).length > 0) return { ok: false, reason: "unknown_group" };
  // `all-hands` is the whole workspace and every clearance contains it, so the
  // scoping check below is a no-op for it. Called out because it reads like an
  // omission otherwise: sharing with everyone is deliberately available to
  // everyone, exactly as filing a KB note at all-hands is.
  if (group === ALL_HANDS) return { ok: true };
  if (isAdmin(sharerEmail, loadGroups())) return { ok: true };
  if (!resolveClearanceForEmail(sharerEmail).includes(group)) {
    return { ok: false, reason: "group_not_in_clearance" };
  }
  return { ok: true };
}
