import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { getIngestCursor, getMeetingJob, setIngestCursor } from "@/lib/db/meetings";
import { pollMeetings } from "./poll";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.AUTHORITY_ENABLED = "1";
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.AUTHORITY_ENABLED;
  delete process.env.MEETINGS_NAME_FILTER;
});

describe("pollMeetings", () => {
  it("discovers, persists, enqueues, and advances the cursor", async () => {
    setIngestCursor(db, "cursor-1");
    const listNewMeetings = vi.fn(async () => ({ ids: ["m1", "m2"], cursor: "cursor-2" }));
    const enqueue = vi.fn();
    await expect(pollMeetings({ db, listNewMeetings, enqueue })).resolves.toEqual({ detail: "enqueued 2 meetings" });
    expect(listNewMeetings).toHaveBeenCalledWith("cursor-1", null);
    expect(enqueue.mock.calls.map((call) => call[0])).toEqual(["m1", "m2"]);
    expect(getMeetingJob(db, "m1")?.state).toBe("queued");
    expect(getIngestCursor(db)).toBe("cursor-2");
  });

  it("passes the configured name filter to discovery", async () => {
    process.env.MEETINGS_NAME_FILTER = "atlas";
    const listNewMeetings = vi.fn(async () => ({ ids: [], cursor: "cursor-2" }));
    await pollMeetings({ db, listNewMeetings, enqueue: vi.fn() });
    expect(listNewMeetings).toHaveBeenCalledWith(null, "atlas");
  });

  it("keeps the stored cursor when discovery returns an empty one", async () => {
    setIngestCursor(db, "cursor-1");
    const listNewMeetings = vi.fn(async () => ({ ids: [], cursor: "" }));
    await pollMeetings({ db, listNewMeetings, enqueue: vi.fn() });
    expect(getIngestCursor(db)).toBe("cursor-1");
  });

  it("does not advance the cursor when discovery fails", async () => {
    setIngestCursor(db, "cursor-1");
    const listNewMeetings = vi.fn(async () => { throw new Error("unavailable"); });
    await expect(pollMeetings({ db, listNewMeetings, enqueue: vi.fn() })).rejects.toThrow("unavailable");
    expect(getIngestCursor(db)).toBe("cursor-1");
  });

  it("does nothing when authority is off", async () => {
    delete process.env.AUTHORITY_ENABLED;
    const listNewMeetings = vi.fn(async () => ({ ids: ["m1"], cursor: "cursor-2" }));
    await expect(pollMeetings({ db, listNewMeetings, enqueue: vi.fn() })).resolves.toEqual({ detail: "authority disabled" });
    expect(listNewMeetings).not.toHaveBeenCalled();
  });
});
