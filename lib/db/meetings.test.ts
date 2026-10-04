import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { upsertMeetingPayload } from "./meeting-payloads";
import {
  getIngestCursor,
  getIngestedMeeting,
  getMeetingJob,
  insertMeetingJob,
  listQueuedMeetingIds,
  markMeetingDone,
  markMeetingError,
  markMeetingProcessing,
  requeueFailedMeetings,
  requeueStuckMeetings,
  setIngestCursor,
  upsertIngestedMeeting,
} from "./meetings";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("requeueFailedMeetings", () => {
  it("replays a failed meeting that still has its stored payload", () => {
    insertMeetingJob(db, "with-payload");
    markMeetingError(db, "with-payload", "invalid_type at attendees.3.name");
    upsertMeetingPayload(db, "with-payload", '{"id":"with-payload"}');

    expect(requeueFailedMeetings(db, "2026-08-28T09:00:00Z")).toEqual(["with-payload"]);
    expect(getMeetingJob(db, "with-payload")).toMatchObject({ state: "queued", error: null });
  });

  it("leaves a failed meeting with no payload alone", () => {
    insertMeetingJob(db, "no-payload");
    markMeetingError(db, "no-payload", "circleback 403");

    expect(requeueFailedMeetings(db)).toEqual([]);
    expect(getMeetingJob(db, "no-payload")?.state).toBe("error");
  });

  it("does not touch done or queued meetings", () => {
    insertMeetingJob(db, "done");
    upsertMeetingPayload(db, "done", "{}");
    markMeetingDone(db, "done");
    insertMeetingJob(db, "queued");
    upsertMeetingPayload(db, "queued", "{}");

    expect(requeueFailedMeetings(db)).toEqual([]);
    expect(getMeetingJob(db, "done")?.state).toBe("done");
  });
});

describe("meeting jobs", () => {
  it("tracks lifecycle and errors", () => {
    insertMeetingJob(db, "m1", "2026-07-11T10:00:00Z");
    expect(getMeetingJob(db, "m1")?.state).toBe("queued");
    markMeetingProcessing(db, "m1", "2026-07-11T10:01:00Z");
    expect(getMeetingJob(db, "m1")?.state).toBe("processing");
    markMeetingError(db, "m1", "bad transcript", "2026-07-11T10:02:00Z");
    expect(getMeetingJob(db, "m1")).toMatchObject({ state: "error", error: "bad transcript" });
    insertMeetingJob(db, "m1", "2026-07-11T10:03:00Z");
    markMeetingDone(db, "m1", "2026-07-11T10:04:00Z");
    expect(getMeetingJob(db, "m1")).toMatchObject({ state: "done", error: null });
  });

  it("recovers processing rows and lists queued ids", () => {
    insertMeetingJob(db, "queued");
    insertMeetingJob(db, "stuck");
    markMeetingProcessing(db, "stuck");
    expect(requeueStuckMeetings(db).sort()).toEqual(["stuck"]);
    expect(listQueuedMeetingIds(db).sort()).toEqual(["queued", "stuck"]);
  });
});

describe("ingested meetings", () => {
  it("upserts one record per meeting id and preserves the path on revision", () => {
    upsertIngestedMeeting(db, {
      meetingId: "m1",
      notePath: "docs/meetings/2026/weekly.md",
      sourceHash: "hash-1",
      ingestedAt: "2026-07-11T10:00:00Z",
    });
    upsertIngestedMeeting(db, {
      meetingId: "m1",
      notePath: "docs/meetings/2026/changed-title.md",
      sourceHash: "hash-2",
      ingestedAt: "2026-07-11T11:00:00Z",
    });
    expect(getIngestedMeeting(db, "m1")).toEqual({
      meetingId: "m1",
      notePath: "docs/meetings/2026/weekly.md",
      sourceHash: "hash-2",
      ingestedAt: "2026-07-11T11:00:00Z",
    });
  });
});

describe("ingest cursor", () => {
  it("gets and sets the shared meetings-poll cursor", () => {
    expect(getIngestCursor(db)).toBeNull();
    setIngestCursor(db, "2026-07-11T10:00:00Z");
    expect(getIngestCursor(db)).toBe("2026-07-11T10:00:00Z");
  });
});
