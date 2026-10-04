import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CirclebackClient, type CirclebackTransport } from "./circleback";
import {
  meetingFromWebhookPayload,
  meetingIdFromWebhookPayload,
  verifyWebhookSignature,
} from "./webhook";

const SECRET = "whsec_abc123";

function sign(body: string, secret = SECRET, encoding: "hex" | "base64" = "hex"): string {
  return createHmac("sha256", secret).update(body, "utf8").digest(encoding);
}

const PAYLOAD = {
  id: "mtg-1",
  name: "  Product Syncup  ",
  createdAt: "2026-08-05T13:00:00.000Z",
  duration: 1800,
  attendees: [
    { name: "Alice", email: "  Alice@Example.COM " },
    { email: "bob@example.com" },
  ],
  tags: ["All-Hands", { id: 1, name: "ignored" }],
  actionItems: [
    {
      id: 42,
      title: "  Ship it  ",
      description: "  do the thing  ",
      status: "done",
      assignee: { name: " Alice ", email: " Alice@Example.COM " },
    },
  ],
  transcript: [
    { speaker: "Alice", text: "hello" },
    { words: "no speaker here" },
  ],
};

// The exact shape that killed meeting 44SiljcvuFXoUMqP1uCa6 in prod on
// 2026-08-28: Circleback sends an unknown value as null, not by omitting it.
const NULLED_PAYLOAD = {
  id: "mtg-null",
  name: "Daily Sync",
  createdAt: "2026-08-27T12:00:00.000Z",
  duration: null,
  attendees: [
    { name: null, email: "carol@example.com" },
    { name: "Dial-in", email: null },
  ],
  tags: null,
  actionItems: [
    { id: 7, title: "Follow up", description: null, status: null, assignee: null },
    { id: 8, title: "Second", description: "x", assignee: { name: null, email: null } },
  ],
  transcript: [{ speaker: null, text: null, words: "spoken" }],
};

describe("meetingFromWebhookPayload null tolerance", () => {
  it("accepts a payload whose optional fields are null", () => {
    const meeting = meetingFromWebhookPayload(NULLED_PAYLOAD);
    expect(meeting.id).toBe("mtg-null");
    expect(meeting.endAt).toBeUndefined();
    expect(meeting.tags).toEqual([]);
    expect(meeting.attendees).toEqual([{ email: "carol@example.com" }, { name: "Dial-in" }]);
    expect(meeting.actionItems[0]).toMatchObject({
      externalId: "7",
      description: "",
      assigneeName: null,
      assigneeEmail: null,
      done: false,
    });
    expect(meeting.actionItems[1]).toMatchObject({ assigneeName: null, assigneeEmail: null });
    expect(meeting.transcript.text).toBe("Unknown: spoken");
  });

  it("accepts a delivery with the list fields missing entirely", () => {
    const meeting = meetingFromWebhookPayload({
      id: "mtg-bare",
      name: "Bare",
      createdAt: "2026-08-27T12:00:00.000Z",
    });
    expect(meeting.attendees).toEqual([]);
    expect(meeting.actionItems).toEqual([]);
    expect(meeting.transcript.text).toBe("");
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a hex digest of the raw body", () => {
    const body = JSON.stringify(PAYLOAD);
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a base64 digest, since the encoding is undocumented", () => {
    const body = JSON.stringify(PAYLOAD);
    expect(verifyWebhookSignature(body, sign(body, SECRET, "base64"), SECRET)).toBe(true);
  });

  it("tolerates surrounding whitespace on the header", () => {
    const body = JSON.stringify(PAYLOAD);
    expect(verifyWebhookSignature(body, `  ${sign(body)}  `, SECRET)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature("{}", null, SECRET)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyWebhookSignature("{}", "   ", SECRET)).toBe(false);
  });

  it("rejects a body altered after signing", () => {
    const body = JSON.stringify(PAYLOAD);
    const signature = sign(body);
    expect(verifyWebhookSignature(`${body} `, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const body = JSON.stringify(PAYLOAD);
    expect(verifyWebhookSignature(body, sign(body, "whsec_other"), SECRET)).toBe(false);
  });

  it("rejects a signature of the right length but wrong bytes", () => {
    const body = JSON.stringify(PAYLOAD);
    const wrong = sign(body).replace(/^./, (c) => (c === "a" ? "b" : "a"));
    expect(verifyWebhookSignature(body, wrong, SECRET)).toBe(false);
  });
});

describe("meetingFromWebhookPayload", () => {
  it("maps a full payload into the canonical meeting shape", () => {
    expect(meetingFromWebhookPayload(PAYLOAD)).toEqual({
      id: "mtg-1",
      title: "Product Syncup",
      startAt: "2026-08-05T13:00:00.000Z",
      endAt: "2026-08-05T13:30:00.000Z",
      attendees: [
        { name: "Alice", email: "alice@example.com" },
        { email: "bob@example.com" },
      ],
      tags: ["All-Hands"],
      actionItems: [
        {
          externalId: "42",
          title: "Ship it",
          description: "do the thing",
          assigneeName: "Alice",
          assigneeEmail: "alice@example.com",
          done: true,
        },
      ],
      transcript: { meetingId: "mtg-1", text: "Alice: hello\nUnknown: no speaker here" },
    });
  });

  it("accepts an attendee Circleback has no email for, keeping them as an attendee", () => {
    // Observed on the first real prod delivery (2026-08-07): a participant
    // without an address on the invite arrives as `email: null`, and the
    // schema rejecting it parked the whole meeting in `state: error`.
    const meeting = meetingFromWebhookPayload({
      id: "mtg-3",
      name: "Quick audio test",
      createdAt: "2026-08-05T13:00:00.000Z",
      attendees: [{ name: "Nina Doe", email: null }, { name: "Alice", email: "Alice@Example.com" }],
    });
    expect(meeting.attendees).toEqual([
      { name: "Nina Doe" },
      { name: "Alice", email: "alice@example.com" },
    ]);
  });

  it("accepts a delivery whose action items have not been written yet", () => {
    const meeting = meetingFromWebhookPayload({
      id: "mtg-2",
      name: "Early",
      createdAt: "2026-08-05T13:00:00.000Z",
    });
    expect(meeting.actionItems).toEqual([]);
    expect(meeting.attendees).toEqual([]);
    expect(meeting.transcript).toEqual({ meetingId: "mtg-2", text: "" });
  });

  it("omits endAt when the payload carries no duration", () => {
    const meeting = meetingFromWebhookPayload({
      id: "mtg-3",
      name: "No duration",
      createdAt: "2026-08-05T13:00:00.000Z",
    });
    expect(meeting.endAt).toBeUndefined();
  });

  it("omits endAt rather than emitting an invalid date", () => {
    const meeting = meetingFromWebhookPayload({
      id: "mtg-4",
      name: "Bad date",
      createdAt: "not-a-date",
      duration: 60,
    });
    expect(meeting.endAt).toBeUndefined();
  });

  it("throws on a body with no meeting id", () => {
    expect(() => meetingFromWebhookPayload({ name: "x", createdAt: "2026-08-05" })).toThrow();
  });
});

describe("meetingIdFromWebhookPayload", () => {
  it("reads the id without parsing the rest", () => {
    expect(meetingIdFromWebhookPayload({ id: "mtg-1", garbage: true })).toBe("mtg-1");
  });

  it("returns null when the id is absent or empty", () => {
    expect(meetingIdFromWebhookPayload({ name: "x" })).toBeNull();
    expect(meetingIdFromWebhookPayload({ id: "" })).toBeNull();
  });
});

// The guard that matters most: both ingestion paths must produce a byte-identical
// meeting for the same underlying facts. `runner.ts` hashes this object to decide
// whether to rewrite a note, so any divergence between the poll and the webhook
// would rewrite (and re-commit) the same note every time the other path ran.
describe("parity with the poll path", () => {
  it("produces the same meeting the MCP client builds from equivalent responses", async () => {
    const transport: CirclebackTransport = {
      async call(tool) {
        if (tool === "ReadMeetings") {
          return [{
            id: PAYLOAD.id,
            name: PAYLOAD.name,
            createdAt: PAYLOAD.createdAt,
            duration: PAYLOAD.duration,
            attendees: PAYLOAD.attendees,
            tags: PAYLOAD.tags,
            actionItems: PAYLOAD.actionItems,
          }];
        }
        return [{ id: PAYLOAD.id, transcript: PAYLOAD.transcript }];
      },
    };

    const fromPoll = await new CirclebackClient(transport).getMeeting(PAYLOAD.id);
    const fromWebhook = meetingFromWebhookPayload(PAYLOAD);

    expect(fromWebhook).toEqual(fromPoll);
    expect(JSON.stringify(fromWebhook)).toBe(JSON.stringify(fromPoll));
  });
});
