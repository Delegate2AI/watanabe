import type { ActionItem } from "@/lib/meetings/circleback";

/**
 * Turns a meeting's Circleback action items into task seeds.
 *
 * This used to ask a relay agent to call `SearchActionItems` and parse an
 * `{action_items: [...]}` envelope. The real tool has no meeting-id parameter,
 * returns a bare array, and defaults to the authenticated user's items only,
 * so the whole path failed on every meeting and could never have covered the
 * team. `ReadMeetings` already returns `actionItems` for every attendee in a
 * response the meetings runner fetches anyway, so seeding is now a pure
 * mapping with no API call and no model in the loop.
 */

export interface RawTaskItem {
  /** Circleback's own action item id: stable across re-ingests, unlike a title. */
  externalId: string;
  title: string;
  description: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
}

export function seedFromMeeting(actionItems: ActionItem[]): RawTaskItem[] {
  const seen = new Set<string>();
  const items: RawTaskItem[] = [];
  for (const item of actionItems) {
    // An item Circleback already marks DONE should not arrive as a new task.
    if (item.done) continue;
    if (!item.title.trim() || seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    items.push({
      externalId: item.externalId,
      title: item.title,
      // Circleback writes a title for every item but the description can be
      // empty; the title then carries the whole instruction.
      description: item.description || item.title,
      assigneeName: item.assigneeName,
      assigneeEmail: item.assigneeEmail,
    });
  }
  return items;
}
