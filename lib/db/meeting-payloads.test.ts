import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { getMeetingPayload, upsertMeetingPayload } from "./meeting-payloads";

// `meeting_payloads` access: the raw Circleback webhook bodies. The store keeps
// the exact string it was handed, because that string is what the HMAC covered
// and re-serializing it would invalidate any later re-verification.

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("getMeetingPayload", () => {
  it("returns null for a meeting that was never delivered", () => {
    expect(getMeetingPayload(db, "missing")).toBeNull();
  });
});

describe("upsertMeetingPayload", () => {
  it("round-trips a stored payload", () => {
    upsertMeetingPayload(db, "m1", '{"id":"m1"}', "2026-08-06T10:00:00.000Z");
    expect(getMeetingPayload(db, "m1")).toEqual({
      meetingId: "m1",
      payload: '{"id":"m1"}',
      receivedAt: "2026-08-06T10:00:00.000Z",
    });
  });

  it("preserves the body byte for byte, including key order and whitespace", () => {
    const raw = '{ "name":"Sync",  "id":"m1" }';
    upsertMeetingPayload(db, "m1", raw);
    expect(getMeetingPayload(db, "m1")?.payload).toBe(raw);
  });

  it("replaces an earlier delivery when Circleback revises the meeting", () => {
    upsertMeetingPayload(db, "m1", '{"id":"m1","v":1}', "2026-08-06T10:00:00.000Z");
    upsertMeetingPayload(db, "m1", '{"id":"m1","v":2}', "2026-08-06T11:00:00.000Z");
    const stored = getMeetingPayload(db, "m1");
    expect(stored?.payload).toBe('{"id":"m1","v":2}');
    expect(stored?.receivedAt).toBe("2026-08-06T11:00:00.000Z");
  });

  it("keeps separate meetings independent", () => {
    upsertMeetingPayload(db, "m1", '{"id":"m1"}');
    upsertMeetingPayload(db, "m2", '{"id":"m2"}');
    expect(getMeetingPayload(db, "m1")?.payload).toBe('{"id":"m1"}');
    expect(getMeetingPayload(db, "m2")?.payload).toBe('{"id":"m2"}');
  });
});
