import { z } from "zod";

/**
 * The canonical in-repo shape of a meeting, plus the normalizers that build it.
 *
 * Two sources produce this shape now: the MCP poll (`circleback.ts`, which
 * assembles it from ReadMeetings + GetTranscriptsForMeetings) and the webhook
 * receiver (`webhook.ts`, which gets the same facts pushed in one POST). They
 * MUST agree field for field, because `runner.ts` hashes this object to decide
 * whether a note needs rewriting. If the two paths normalized an email's case
 * or a transcript's separator differently, the same meeting arriving by both
 * routes would produce two hashes and rewrite its note on every ingest, so the
 * normalizers live here rather than being duplicated per source.
 */

export interface Attendee {
  name?: string;
  /**
   * Optional, because Circleback reports a participant it has no address for
   * as `email: null` (a dial-in, or someone missing from the invite). Such an
   * attendee is UNIDENTIFIABLE, not absent: `deriveMeetingVisibility` reads
   * that as uncertainty and keeps the meeting off all-hands, so dropping them
   * here would quietly widen who can read the note.
   */
  email?: string;
}

export interface Transcript {
  meetingId: string;
  text: string;
}

/**
 * An action item as Circleback already resolved it: stable id, written title
 * and description, and the assignee's email. Both sources return these for
 * every attendee, not just the authenticated user, which is why task
 * extraction needs no per-assignee fan-out and no second API call.
 */
export interface ActionItem {
  externalId: string;
  title: string;
  description: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  done: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  startAt: string;
  endAt?: string;
  attendees: Attendee[];
  tags: string[];
  actionItems: ActionItem[];
  transcript: Transcript;
}

// `.nullish()` everywhere an optional field appears: Circleback sends an
// unknown value as JSON `null`, not by omitting the key, and zod's `.optional()`
// rejects null. Every rejection here throws out the WHOLE meeting, since the
// runner parses the delivery as one object. That happened three times on the
// same schema: `attendees[].email` (2026-08-07), then `attendees[].name` and
// `actionItems[].assignee` together (2026-08-28, meeting 44SiljcvuFXoUMqP1uCa6
// in prod). Only `id` and `title` are still required, because an action item
// with neither has nothing to write.
export const attendeeSchema = z.object({
  name: z.string().nullish(),
  email: z.string().min(1).nullish(),
});

export const actionItemSchema = z.object({
  // Numeric on the live API; accept a string so a future widening cannot drop
  // every item on the floor.
  id: z.union([z.number(), z.string()]),
  title: z.string().trim().min(1),
  description: z.string().nullish(),
  status: z.string().nullish(),
  assignee: z.object({
    name: z.string().nullish(),
    email: z.string().nullish(),
  }).nullish(),
});

export const transcriptSegmentSchema = z.object({
  speaker: z.string().nullish(),
  // Observed live as `text`; the tool description says `words`. Accept both.
  text: z.string().nullish(),
  words: z.string().nullish(),
});

export type ActionItemInput = z.infer<typeof actionItemSchema>;
export type AttendeeInput = z.infer<typeof attendeeSchema>;
export type TranscriptSegmentInput = z.infer<typeof transcriptSegmentSchema>;

/**
 * Circleback dates the meeting by `createdAt` and gives length as a duration in
 * seconds, so the end is derived rather than reported. An unparseable date
 * yields no end rather than an `Invalid Date` string in frontmatter.
 */
export function computeEndAt(startAt: string, duration: number | undefined): string | undefined {
  if (duration === undefined) return undefined;
  const startMs = Date.parse(startAt);
  if (!Number.isFinite(startMs)) return undefined;
  return new Date(startMs + Math.round(duration * 1000)).toISOString();
}

/**
 * Email is the join key into `access/groups.yaml` for clearance derivation, and
 * that lookup is case-sensitive on both sides, so it is lowercased here at the
 * single point where meetings enter the system.
 */
export function normalizeAttendees(attendees: AttendeeInput[]): Attendee[] {
  return attendees.map((attendee) => {
    const email = attendee.email?.trim().toLowerCase();
    return {
      ...(typeof attendee.name === "string" ? { name: attendee.name } : {}),
      ...(email ? { email } : {}),
    };
  });
}

/** Tags arrive as objects on some payloads; keep only the plain string ones. */
export function normalizeTags(tags: unknown[]): string[] {
  return tags.filter((tag): tag is string => typeof tag === "string");
}

export function normalizeActionItems(items: ActionItemInput[]): ActionItem[] {
  return items.map((item) => ({
    externalId: String(item.id),
    title: item.title.trim(),
    description: (item.description ?? "").trim(),
    assigneeName: item.assignee?.name?.trim() || null,
    assigneeEmail: item.assignee?.email?.trim().toLowerCase() || null,
    done: item.status?.trim().toUpperCase() === "DONE",
  }));
}

export function joinTranscript(meetingId: string, segments: TranscriptSegmentInput[]): Transcript {
  return {
    meetingId,
    text: segments
      .map((segment) => `${segment.speaker ?? "Unknown"}: ${segment.text ?? segment.words ?? ""}`)
      .join("\n"),
  };
}
