import { canonicalEmail, type AliasIndex } from "@/lib/authority/aliases";
import { readFrontmatter } from "@/lib/index/frontmatter";

/**
 * The attendee list a task is stamped with, in the one form the visibility SQL
 * compares against: canonical, lower-cased, deduped, in first-seen order.
 *
 * Canonicalization is the whole point. A calendar invite records whatever
 * address the person was invited under, which is frequently not the address
 * their portal session authenticates as, and `requesterKey` resolves the reader
 * to canonical on every query. Matching raw invite addresses would grant nothing
 * to the people this list exists for.
 *
 * Never throws: a missing or malformed source yields an empty list, which reads
 * downstream as "no attendance grant" and leaves clearance in charge.
 */
export function canonicalAttendees(
  emails: readonly (string | null | undefined)[],
  aliases: AliasIndex = {},
): string[] {
  const seen = new Set<string>();
  for (const raw of emails) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    seen.add(canonicalEmail(trimmed, aliases));
  }
  return [...seen];
}

/**
 * The same list read off a meeting note's `attendees:` frontmatter, for the two
 * paths that have the note rather than the Circleback payload: the task runner's
 * own context load, and the `bootTasks()` backfill of rows written before
 * attendance was recorded.
 */
export function attendeesFromNote(contents: string, aliases: AliasIndex = {}): string[] {
  const frontmatter = readFrontmatter(contents);
  if (frontmatter.status === "unparseable") return [];
  const field = frontmatter.fields.attendees;
  if (!Array.isArray(field)) return [];
  return canonicalAttendees(field as (string | null | undefined)[], aliases);
}
