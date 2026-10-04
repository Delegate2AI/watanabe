import { z } from "zod";
import { circlebackCredentials, DirectCirclebackTransport } from "./circleback-direct";
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

// Response schemas below mirror the REAL Circleback MCP (verified live against
// app.circleback.ai on 2026-08-01), which differs from the API spec 20 was
// written against: tools return bare JSON arrays, listing is page-based (20 per
// page, no cursor), ReadMeetings has name/createdAt/duration rather than
// title/start_at/end_at, transcripts arrive as per-utterance segments, and
// there is no profile lookup with an internal/external flag.

export type CirclebackTool = "SearchMeetings" | "ReadMeetings" | "GetTranscriptsForMeetings";

export interface CirclebackTransport {
  call(tool: CirclebackTool, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Circleback tool results sometimes arrive re-wrapped: observed live outputs
 * include the bare value, a JSON-stringified value, and a stringified
 * {"result": <value>} envelope (sometimes several layers deep). Peel every
 * layer; reject prose so a Circleback-side error message fails loudly instead
 * of parsing as an empty page.
 */
export function coerceToolResult(value: unknown): unknown {
  if (typeof value === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Circleback tool returned a non-JSON string: ${value.slice(0, 200)}`);
    }
    return coerceToolResult(parsed);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "result") {
      return coerceToolResult((value as { result: unknown }).result);
    }
  }
  return value;
}

// The meeting shape and its normalizers are shared with the webhook receiver;
// see meeting-shape.ts for why the two paths must not normalize separately.
// Re-exported so every existing `from "./circleback"` import site is unchanged.
export type { ActionItem, Attendee, Meeting, Transcript } from "./meeting-shape";

const searchPageSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string().min(1),
}));

// `.nullish()` rather than `.default()` on every optional: the poll reads the
// same records the webhook pushes, so a null that the webhook now tolerates
// must not still reject the meeting here. See the note above `attendeeSchema`.
const readSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  duration: z.number().nonnegative().nullish(),
  attendees: z.array(attendeeSchema).nullish(),
  tags: z.array(z.unknown()).nullish(),
  // A meeting whose action items are still being generated simply has none:
  // Circleback writes them a few minutes after the meeting ends.
  actionItems: z.array(actionItemSchema).nullish(),
}));

const transcriptsSchema = z.array(z.object({
  id: z.string().min(1),
  transcript: z.array(transcriptSegmentSchema).nullish(),
}));

const PAGE_SIZE = 20;
const MAX_PAGES = 25;

export class CirclebackClient {
  constructor(private readonly transport: CirclebackTransport) {}

  async listNewMeetings(cursor: string | null, nameFilter: string | null): Promise<{ ids: string[]; cursor: string }> {
    const filter = nameFilter?.trim().toLowerCase() || null;
    const matched: Array<{ id: string; createdAt: string }> = [];
    let maxCreatedAt = cursor ?? "";
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const page = searchPageSchema.parse(await this.transport.call("SearchMeetings", {
        intent: "List meetings for portal knowledge-base ingestion",
        pageIndex,
        ...(filter ? { searchTerm: filter } : {}),
        // startDate is date-granular; the strict createdAt comparison below is
        // what actually advances past same-day meetings already ingested.
        ...(cursor ? { startDate: cursor.slice(0, 10) } : {}),
      }));
      for (const item of page) {
        if (item.createdAt > maxCreatedAt) maxCreatedAt = item.createdAt;
        if (cursor && item.createdAt <= cursor) continue;
        if (filter && !item.name.toLowerCase().includes(filter)) continue;
        matched.push({ id: item.id, createdAt: item.createdAt });
      }
      if (page.length < PAGE_SIZE) break;
    }
    matched.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return { ids: matched.map((item) => item.id), cursor: maxCreatedAt };
  }

  async getMeeting(id: string): Promise<Meeting> {
    const readResult = readSchema.parse(await this.transport.call("ReadMeetings", {
      intent: "Fetch meeting metadata for portal knowledge-base ingestion",
      meetingIds: [id],
    }));
    const metadata = readResult.find((meeting) => meeting.id === id);
    if (!metadata) throw new Error(`Circleback meeting not found: ${id}`);

    const transcriptResult = transcriptsSchema.parse(await this.transport.call("GetTranscriptsForMeetings", {
      intent: "Fetch meeting transcript for portal knowledge-base ingestion",
      meetingIds: [id],
    }));
    const transcript = transcriptResult.find((item) => item.id === id);
    if (!transcript) throw new Error(`Circleback transcript not found: ${id}`);

    return {
      id: metadata.id,
      title: metadata.name.trim(),
      startAt: metadata.createdAt,
      endAt: computeEndAt(metadata.createdAt, metadata.duration ?? undefined),
      attendees: normalizeAttendees(metadata.attendees ?? []),
      tags: normalizeTags(metadata.tags ?? []),
      actionItems: normalizeActionItems(metadata.actionItems ?? []),
      transcript: joinTranscript(transcript.id, transcript.transcript ?? []),
    };
  }
}

const globalTransport = globalThis as unknown as { __circlebackTransport?: CirclebackTransport };

export function configureCirclebackTransport(transport: CirclebackTransport): void {
  globalTransport.__circlebackTransport = transport;
}

export function configuredCirclebackClient(): CirclebackClient {
  if (globalTransport.__circlebackTransport) {
    return new CirclebackClient(globalTransport.__circlebackTransport);
  }
  // Only the direct MCP transport is trusted: it returns exact bytes with no
  // model in the loop (see circleback-direct.ts). Missing credentials fail
  // loudly here; the former model-relay fallback masked exactly that failure
  // in prod (2026-08-28) as an unreadable schema error.
  if (!circlebackCredentials()) {
    throw new Error(
      "circleback credentials missing: seed a circleback mcpOAuth entry in CLAUDE_CONFIG_DIR/.credentials.json",
    );
  }
  return new CirclebackClient(new DirectCirclebackTransport());
}
