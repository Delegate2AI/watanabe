import { canonicalEmail, loadAliasIndex, type AliasIndex } from "@/lib/authority/aliases";
import type { Groups } from "@/lib/authority/groups";
import type { RawTaskItem } from "./seed";

/**
 * Maps a Circleback action item's assignee onto a portal identity.
 *
 * Circleback returns the assignee's email on every action item, so this is a
 * lookup rather than the FindProfiles agent round trip it replaced. Assignment
 * still fails closed: an address that does not resolve to a known group member
 * leaves the task unassigned for a human to route, never guessed at.
 */

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveAssignee(
  item: RawTaskItem,
  groups: Groups,
  aliases: AliasIndex = loadAliasIndex(),
): string | null {
  if (!item.assigneeEmail) return null;
  // The meeting system knows people by whatever address they joined with,
  // often a personal one. Resolve to the canonical portal identity first and
  // assign that, never the alias.
  const canonical = canonicalEmail(item.assigneeEmail, aliases);
  const members = new Set(Object.values(groups).flat().map(normalized));
  return members.has(normalized(canonical)) ? canonical : null;
}
