import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { upsertMeetingPayload } from "@/lib/db/meeting-payloads";

const getMeetingMock = vi.fn();
vi.mock("./circleback", () => ({
  configuredCirclebackClient: () => ({ getMeeting: (id: string) => getMeetingMock(id) }),
}));

const { resolveMeeting } = await import("./runner");

const PAYLOAD = JSON.stringify({
  id: "m1",
  name: "Pushed Meeting",
  createdAt: "2026-08-05T13:00:00.000Z",
  attendees: [{ email: "alice@example.com" }],
});

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  getMeetingMock.mockReset().mockResolvedValue({ id: "m1", title: "From API" });
});

describe("resolveMeeting", () => {
  it("builds the meeting from a stored webhook payload", async () => {
    upsertMeetingPayload(db, "m1", PAYLOAD);
    const meeting = await resolveMeeting(db, "m1");
    expect(meeting.title).toBe("Pushed Meeting");
    expect(meeting.attendees).toEqual([{ email: "alice@example.com" }]);
  });

  // The point of the ordering: a webhook meeting belongs to another workspace
  // member, so an API call for it would fail on permissions rather than return
  // it. Preferring the payload is what keeps that call from ever being made.
  it("never calls the Circleback API when a payload is stored", async () => {
    upsertMeetingPayload(db, "m1", PAYLOAD);
    await resolveMeeting(db, "m1");
    expect(getMeetingMock).not.toHaveBeenCalled();
  });

  it("falls back to the API for a meeting the poll discovered", async () => {
    const meeting = await resolveMeeting(db, "m1");
    expect(getMeetingMock).toHaveBeenCalledWith("m1");
    expect(meeting.title).toBe("From API");
  });

  it("fails rather than falling back when a stored payload is unreadable", async () => {
    upsertMeetingPayload(db, "m1", "{ not json");
    await expect(resolveMeeting(db, "m1")).rejects.toThrow();
    expect(getMeetingMock).not.toHaveBeenCalled();
  });

  it("uses the newest delivery after Circleback revises a meeting", async () => {
    upsertMeetingPayload(db, "m1", PAYLOAD);
    upsertMeetingPayload(db, "m1", JSON.stringify({
      id: "m1",
      name: "Revised Meeting",
      createdAt: "2026-08-05T13:00:00.000Z",
    }));
    expect((await resolveMeeting(db, "m1")).title).toBe("Revised Meeting");
  });
});
