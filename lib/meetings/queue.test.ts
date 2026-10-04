import { beforeEach, describe, expect, it, vi } from "vitest";

const runMeetingJobMock = vi.fn(async (id: string) => {
  void id;
});
vi.mock("./runner", () => ({ runMeetingJob: (id: string) => runMeetingJobMock(id) }));

const { bootMeetings, enqueueMeeting, __resetMeetingsQueueForTests } = await import("./queue");
const { openDb } = await import("@/lib/db/client");
const { insertMeetingJob, markMeetingDone, markMeetingProcessing } = await import("@/lib/db/meetings");

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  __resetMeetingsQueueForTests();
  runMeetingJobMock.mockClear();
});

describe("enqueueMeeting", () => {
  it("runs jobs in order and continues after rejection", async () => {
    const events: string[] = [];
    const run = vi.fn(async (id: string) => {
      events.push(id);
      if (id === "bad") throw new Error("bad");
    });
    enqueueMeeting("one", run);
    enqueueMeeting("bad", run);
    enqueueMeeting("two", run);
    await flush();
    await flush();
    expect(events).toEqual(["one", "bad", "two"]);
  });
});

describe("bootMeetings", () => {
  it("requeues stuck jobs and drains all queued jobs", async () => {
    const db = openDb(":memory:");
    insertMeetingJob(db, "queued");
    insertMeetingJob(db, "stuck");
    insertMeetingJob(db, "done");
    markMeetingProcessing(db, "stuck");
    markMeetingDone(db, "done");
    bootMeetings(db);
    await flush();
    expect(runMeetingJobMock.mock.calls.map((call) => call[0]).sort()).toEqual(["queued", "stuck"]);
  });
});
