import { canonicalEmail, type AliasIndex } from "@/lib/authority/aliases";
import { resolveClearance, type Groups } from "@/lib/authority/groups";
import type { Attendee } from "./circleback";

function isKnown(email: string, groups: Groups): boolean {
  const normalized = email.trim().toLowerCase();
  return Object.values(groups).some((members) =>
    members.some((member) => member.trim().toLowerCase() === normalized),
  );
}

export function deriveMeetingVisibility(
  attendees: Attendee[],
  groups: Groups,
  aliases: AliasIndex = {},
): string[] {
  const candidate = new Set<string>();
  let hasUncertainty = false;
  let hasKnownInternal = false;

  // Circleback exposes no internal/external attendee flag, so membership in
  // the access groups IS the internal signal: a grouped email is internal,
  // anything else is uncertainty. External systems record people under other
  // addresses (a personal email on a meeting invite), so each attendee is
  // first resolved to their canonical identity via the alias registry.
  for (const attendee of attendees) {
    // No address at all is the strongest form of the same uncertainty an
    // unknown address carries: there is nobody to resolve, so this attendee
    // can never vouch for the meeting being all-internal.
    if (!attendee.email) {
      hasUncertainty = true;
      continue;
    }
    const email = canonicalEmail(attendee.email, aliases);
    if (!isKnown(email, groups)) {
      hasUncertainty = true;
      continue;
    }
    hasKnownInternal = true;
    for (const group of resolveClearance(email, groups)) candidate.add(group);
  }

  if (hasUncertainty) candidate.delete("all-hands");

  // Absence of any positively-resolved internal attendee is itself uncertainty,
  // not an ordinary all-internal meeting. An empty attendee list (Circleback can
  // return a recording with no identified participants) or a list where nobody
  // resolved to a known group must never fall through to all-hands. Fail closed
  // to admins, the most restrictive clearance.
  if (!hasKnownInternal) return ["admins"];

  if (candidate.size === 0) return hasUncertainty ? ["admins"] : ["all-hands"];

  return [...candidate].sort((left, right) => {
    if (left === "all-hands") return -1;
    if (right === "all-hands") return 1;
    return left.localeCompare(right);
  });
}
