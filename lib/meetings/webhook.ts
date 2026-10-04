import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  actionItemSchema,
  attendeeSchema,
  computeEndAt,
  joinTranscript,
  normalizeActionItems,
  normalizeAttendees,
  normalizeTags,
  transcriptSegmentSchema,
  type Meeting,
} from "./meeting-shape";

/**
 * Circleback webhook ingestion: signature verification and payload mapping.
 *
 * A workspace admin creates one "after every meeting -> send webhook request"
 * automation and enables it for the workspace, which makes it run on every
 * member's meetings. That is the only way to reach meetings the operator did
 * not attend: Circleback's OAuth advertises a single `user` scope, so no token,
 * however privileged its holder, reads another member's meetings.
 *
 * The payload carries in one POST what the poll assembles from three MCP calls
 * (ReadMeetings + GetTranscriptsForMeetings + the SearchMeetings listing), so
 * the mapping below is deliberately the same normalizers the poll uses.
 */

// Every list and every optional scalar is `.nullish()` with a null-tolerant
// fallback rather than `.default()`, because `.default()` fills in for an
// ABSENT key only: a key present as JSON `null` still fails, and one failure
// rejects the whole meeting. See the note above `attendeeSchema`.
const webhookPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  duration: z.number().nonnegative().nullish(),
  attendees: z.array(attendeeSchema).nullish(),
  tags: z.array(z.unknown()).nullish(),
  // Action items are written minutes after the meeting ends, so an early
  // delivery legitimately has none. Same tolerance as the poll path.
  actionItems: z.array(actionItemSchema).nullish(),
  transcript: z.array(transcriptSegmentSchema).nullish(),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/**
 * Parse a verified webhook body into the canonical meeting shape. Throws on a
 * malformed body: the caller answers 400 rather than enqueueing a job that
 * would fail later with no way back to the sender.
 */
export function meetingFromWebhookPayload(raw: unknown): Meeting {
  const payload = webhookPayloadSchema.parse(raw);
  return {
    id: payload.id,
    title: payload.name.trim(),
    startAt: payload.createdAt,
    endAt: computeEndAt(payload.createdAt, payload.duration ?? undefined),
    attendees: normalizeAttendees(payload.attendees ?? []),
    tags: normalizeTags(payload.tags ?? []),
    actionItems: normalizeActionItems(payload.actionItems ?? []),
    transcript: joinTranscript(payload.id, payload.transcript ?? []),
  };
}

/** Reads just the meeting id, so a delivery can be keyed before it is fully parsed. */
export function meetingIdFromWebhookPayload(raw: unknown): string | null {
  const parsed = z.object({ id: z.string().min(1) }).safeParse(raw);
  return parsed.success ? parsed.data.id : null;
}

function equals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // comparison outcome through an exception, so length is checked first.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify the `x-signature` header against an HMAC-SHA256 of the RAW body.
 *
 * The body must be the exact bytes received, never a re-serialized object: JSON
 * round-tripping reorders keys and drops insignificant whitespace, and either
 * changes the digest.
 *
 * UNVERIFIED AGAINST A LIVE DELIVERY. Circleback documents the header name, the
 * algorithm, and a `whsec_`-prefixed secret, but not whether the digest is hex
 * or base64, nor whether the prefix is part of the HMAC key. Both digest
 * encodings are accepted, and the key is used verbatim including its prefix
 * (the common convention). Confirm with the "Send request for most recent
 * meeting" button on the automation before trusting this in prod: a wrong guess
 * here fails closed (every delivery 401s), it does not admit forged ones.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const provided = signature.trim();
  if (!provided) return false;
  const mac = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return equals(provided, mac.toString("hex")) || equals(provided, mac.toString("base64"));
}
