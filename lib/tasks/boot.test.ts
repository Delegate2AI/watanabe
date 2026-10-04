import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { getTaskForRequester, insertProposed } from "@/lib/db/tasks";
import { bootTasks } from "./boot";

const ORIGINAL = { ...process.env };

const NOTE = () => [
  "---",
  "type: meeting",
  "visibility:",
  "  - admins",
  "attendees:",
  "  - Dana@Example.com",
  "  - fern@example.com",
  "---",
  "",
  "Notes.",
].join("\n");

function meetingTask(db: DatabaseType, id: string, notePath: string | null): void {
  insertProposed(db, {
    id,
    title: "Fix the background video",
    description: "Shorten it to clear the five minute limit.",
    assigneeEmail: null,
    sourceMeetingId: "circleback:m1",
    sourceNotePath: notePath,
    clearance: ["admins"],
    due: null,
    origin: "circleback",
    createdAt: "2026-08-05T12:00:00Z",
  });
}

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe("bootTasks", () => {
  it("is a no-op when TASKS_ENABLED is off (default)", () => {
    delete process.env.TASKS_ENABLED;
    expect(() => bootTasks()).not.toThrow();
  });

  it("is a no-op when only MEETINGS_ENABLED is set (tasks still gated off)", () => {
    process.env.MEETINGS_ENABLED = "1";
    delete process.env.TASKS_ENABLED;
    expect(() => bootTasks()).not.toThrow();
  });

  it("does not throw when enabled and there is nothing to backfill", () => {
    process.env.TASKS_ENABLED = "1";
    process.env.MEETINGS_ENABLED = "1";
    expect(() => bootTasks({ db: openDb(":memory:"), aliases: {}, readNote: NOTE })).not.toThrow();
  });

  // The backfill exists because extraction is idempotent: a task already in the
  // table never re-runs, so without this pass every action item that predates
  // the attendee column stays invisible to the people who were in the meeting.
  describe("the attendee backfill", () => {
    beforeEach(() => {
      process.env.TASKS_ENABLED = "1";
    });

    it("stamps attendees from the source note onto rows that have none", () => {
      const db = openDb(":memory:");
      meetingTask(db, "t1", "docs/meetings/2026/stream.md");

      bootTasks({ db, aliases: {}, readNote: NOTE });

      // Canonical and lower-cased, which is the form the visibility SQL compares.
      expect(getTaskForRequester(db, "t1", "dana@example.com", ["all-hands"])?.sourceAttendees)
        .toEqual(["dana@example.com", "fern@example.com"]);
    });

    it("reads each distinct note once, however many tasks came out of it", () => {
      const db = openDb(":memory:");
      meetingTask(db, "t1", "docs/meetings/2026/stream.md");
      meetingTask(db, "t2", "docs/meetings/2026/stream.md");
      const readNote = vi.fn(NOTE);

      bootTasks({ db, aliases: {}, readNote });

      expect(readNote).toHaveBeenCalledTimes(1);
      expect(getTaskForRequester(db, "t2", "fern@example.com", ["all-hands"])).not.toBeNull();
    });

    it("leaves a row alone when its note cannot be read, rather than failing boot", () => {
      const db = openDb(":memory:");
      meetingTask(db, "t1", "docs/meetings/2026/deleted.md");
      const readNote = vi.fn(() => { throw new Error("ENOENT"); });

      expect(() => bootTasks({ db, aliases: {}, readNote })).not.toThrow();
      expect(getTaskForRequester(db, "t1", "admin@example.com", ["admins"])?.sourceAttendees).toEqual([]);
    });

    it("skips a manual task, which has no meeting to read attendees from", () => {
      const db = openDb(":memory:");
      meetingTask(db, "t1", null);
      const readNote = vi.fn(NOTE);

      bootTasks({ db, aliases: {}, readNote });

      expect(readNote).not.toHaveBeenCalled();
    });

    it("does not re-read notes on the next boot, once the rows are stamped", () => {
      const db = openDb(":memory:");
      meetingTask(db, "t1", "docs/meetings/2026/stream.md");
      bootTasks({ db, aliases: {}, readNote: NOTE });

      const readNote = vi.fn(NOTE);
      bootTasks({ db, aliases: {}, readNote });

      expect(readNote).not.toHaveBeenCalled();
    });
  });

  it("never throws even if the flag check throws (resilience contract)", async () => {
    vi.resetModules();
    vi.doMock("./config", () => ({
      isTasksEnabled: () => {
        throw new Error("boom");
      },
    }));
    const { bootTasks: guarded } = await import("./boot");
    expect(() => guarded()).not.toThrow();
    vi.doUnmock("./config");
    vi.resetModules();
  });
});
