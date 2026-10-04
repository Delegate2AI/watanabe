import { loadGroups } from "./groups";

/**
 * Every known member email across all groups, unique and sorted (spec 28
 * sharing autocomplete). This is a directory of people to SUGGEST as share
 * recipients, not an access decision: shared-doc access is an explicit ACL and
 * never consults group clearance, so this list is deliberately unscoped by
 * clearance. With authority off it is empty. The owner can still share with any
 * valid email whether or not it appears here.
 */
export function knownMemberEmails(): string[] {
  const groups = loadGroups();
  const emails = new Set<string>();
  for (const members of Object.values(groups)) {
    for (const email of members) emails.add(email);
  }
  return [...emails].sort((a, b) => a.localeCompare(b));
}
