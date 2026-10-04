import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CirclebackClient,
  coerceToolResult,
  configuredCirclebackClient,
  type CirclebackTransport,
} from "./circleback";

describe("configuredCirclebackClient", () => {
  it("refuses loudly when no CLI credentials are stored instead of degrading to the relay", () => {
    const g = globalThis as { __circlebackTransport?: CirclebackTransport };
    const prior = g.__circlebackTransport;
    delete g.__circlebackTransport;
    const priorConfig = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), "cb-config-"));
    try {
      expect(() => configuredCirclebackClient()).toThrow(/circleback credentials missing/i);
    } finally {
      if (prior !== undefined) g.__circlebackTransport = prior;
      if (priorConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = priorConfig;
    }
  });
});

describe("coerceToolResult", () => {
  it("parses a JSON-stringified result (agents sometimes stringify the array)", () => {
    expect(coerceToolResult('[{"id":"m1"}]')).toEqual([{ id: "m1" }]);
  });

  it("passes structured values through untouched", () => {
    expect(coerceToolResult([{ id: "m1" }])).toEqual([{ id: "m1" }]);
  });

  it("unwraps a string-encoded double {result: ...} wrapper (observed in production)", () => {
    expect(coerceToolResult('{"result": [{"id":"m1"}]}')).toEqual([{ id: "m1" }]);
  });

  it("unwraps a plain {result: ...} object wrapper", () => {
    expect(coerceToolResult({ result: [{ id: "m1" }] })).toEqual([{ id: "m1" }]);
  });

  it("throws a descriptive error for a non-JSON string", () => {
    expect(() => coerceToolResult("No meetings found.")).toThrow(/non-JSON string/);
  });
});

// Fixtures mirror the real Circleback MCP response shapes (verified live
// 2026-08-01): SearchMeetings and ReadMeetings return bare arrays, transcripts
// arrive as per-utterance segments, and there is no profile/external concept.
function fixtureTransport(): CirclebackTransport {
  return {
    call: vi.fn(async (tool: string) => {
      if (tool === "SearchMeetings") {
        return [
          { id: "m3", name: "Atlas sync up ", createdAt: "2026-07-28T23:00:36.923Z", notes: "..." },
          { id: "m2", name: "Acme retro", createdAt: "2026-07-27T10:00:00.000Z", notes: "atlas mentioned in notes only" },
          { id: "m1", name: "Atlas SyncUp", createdAt: "2026-07-20T20:59:36.899Z", notes: "..." },
        ];
      }
      if (tool === "ReadMeetings") {
        return [{
          id: "m3",
          name: "Atlas sync up ",
          createdAt: "2026-07-28T23:00:00.000Z",
          duration: 1895.6,
          attendees: [
            { name: "Alice", email: "alice@example.com" },
            { name: "Guest", email: "guest@outside.test" },
          ],
          tags: [],
          url: "https://meet.example.test",
        }];
      }
      if (tool === "GetTranscriptsForMeetings") {
        return [{
          id: "m3",
          meetingName: "Atlas sync up ",
          transcript: [
            { speaker: "Alice", text: "Hello", timestamp: 4.08 },
            { speaker: "Guest", text: "Hi", timestamp: 5.44 },
          ],
        }];
      }
      throw new Error(`unexpected tool ${tool}`);
    }),
  };
}

describe("CirclebackClient", () => {
  it("filters listed meetings by name, not notes, case-insensitively", async () => {
    const transport = fixtureTransport();
    const client = new CirclebackClient(transport);
    await expect(client.listNewMeetings(null, "atlas")).resolves.toEqual({
      ids: ["m1", "m3"],
      cursor: "2026-07-28T23:00:36.923Z",
    });
    expect(transport.call).toHaveBeenCalledWith(
      "SearchMeetings",
      expect.objectContaining({ pageIndex: 0, searchTerm: "atlas" }),
    );
  });

  it("returns only meetings created strictly after the cursor and passes startDate", async () => {
    const transport = fixtureTransport();
    const client = new CirclebackClient(transport);
    await expect(client.listNewMeetings("2026-07-27T10:00:00.000Z", null)).resolves.toEqual({
      ids: ["m3"],
      cursor: "2026-07-28T23:00:36.923Z",
    });
    expect(transport.call).toHaveBeenCalledWith(
      "SearchMeetings",
      expect.objectContaining({ startDate: "2026-07-27" }),
    );
  });

  it("keeps the prior cursor when nothing new is found", async () => {
    const transport = fixtureTransport();
    const client = new CirclebackClient(transport);
    const result = await client.listNewMeetings("2026-07-29T00:00:00.000Z", "atlas");
    expect(result).toEqual({ ids: [], cursor: "2026-07-29T00:00:00.000Z" });
  });

  it("pages through full result pages", async () => {
    const pageOne = Array.from({ length: 20 }, (_, index) => ({
      id: `p${index}`,
      name: "Atlas planning",
      createdAt: `2026-07-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    const transport: CirclebackTransport = {
      call: vi.fn(async (_tool: string, input: Record<string, unknown>) =>
        input.pageIndex === 0 ? pageOne : [{ id: "p20", name: "Atlas planning", createdAt: "2026-07-02T00:00:00.000Z" }],
      ),
    };
    const result = await new CirclebackClient(transport).listNewMeetings(null, "atlas");
    expect(result.ids).toHaveLength(21);
    expect(transport.call).toHaveBeenCalledTimes(2);
  });

  it("combines metadata and joined transcript segments into a meeting", async () => {
    const meeting = await new CirclebackClient(fixtureTransport()).getMeeting("m3");
    expect(meeting).toEqual({
      id: "m3",
      title: "Atlas sync up",
      startAt: "2026-07-28T23:00:00.000Z",
      endAt: "2026-07-28T23:31:35.600Z",
      attendees: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Guest", email: "guest@outside.test" },
      ],
      tags: [],
      actionItems: [],
      transcript: { meetingId: "m3", text: "Alice: Hello\nGuest: Hi" },
    });
  });

  it("carries the action items ReadMeetings returns for every attendee", async () => {
    const transport = fixtureTransport();
    vi.mocked(transport.call).mockImplementation(async (tool: string) => {
      if (tool === "ReadMeetings") {
        return [{
          id: "m3",
          name: "Atlas sync up",
          createdAt: "2026-07-28T23:00:00.000Z",
          attendees: [],
          actionItems: [
            {
              id: 23551832,
              title: "Publish the mono repo",
              description: "Reorganize and publish the mono repo.",
              status: "PENDING",
              assignee: { name: "Alice", email: "Alice@Example.com" },
            },
            {
              id: 23551818,
              title: "Chase the invoice",
              description: "Follow up on the outstanding invoice.",
              status: "DONE",
              assignee: { name: "Guest", email: "guest@outside.test" },
            },
            { id: "23551819", title: "Unassigned follow-up", description: "" },
          ],
        }];
      }
      return [{ id: "m3", transcript: [] }];
    });

    const meeting = await new CirclebackClient(transport).getMeeting("m3");
    expect(meeting.actionItems).toEqual([
      {
        externalId: "23551832",
        title: "Publish the mono repo",
        description: "Reorganize and publish the mono repo.",
        assigneeName: "Alice",
        assigneeEmail: "alice@example.com",
        done: false,
      },
      {
        externalId: "23551818",
        title: "Chase the invoice",
        description: "Follow up on the outstanding invoice.",
        assigneeName: "Guest",
        assigneeEmail: "guest@outside.test",
        done: true,
      },
      {
        externalId: "23551819",
        title: "Unassigned follow-up",
        description: "",
        assigneeName: null,
        assigneeEmail: null,
        done: false,
      },
    ]);
  });

  it("treats a meeting whose action items have not been generated yet as having none", async () => {
    const meeting = await new CirclebackClient(fixtureTransport()).getMeeting("m3");
    expect(meeting.actionItems).toEqual([]);
  });

  it("omits endAt when Circleback reports no duration", async () => {
    const transport = fixtureTransport();
    vi.mocked(transport.call).mockImplementation(async (tool: string) => {
      if (tool === "ReadMeetings") {
        return [{ id: "m3", name: "Atlas sync up", createdAt: "2026-07-28T23:00:00.000Z", attendees: [] }];
      }
      return [{ id: "m3", transcript: [{ speaker: "Alice", words: "Hello" }] }];
    });
    const meeting = await new CirclebackClient(transport).getMeeting("m3");
    expect(meeting.endAt).toBeUndefined();
    expect(meeting.transcript.text).toBe("Alice: Hello");
  });
});
