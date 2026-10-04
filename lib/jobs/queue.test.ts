import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { getCursor, getLatestRun, recordStart, setCursor } from "./state";
import { __resetJobsForTests, registerJob } from "./registry";
import { __resetJobQueuesForTests, bootJobs, enqueue } from "./queue";

type Db = ReturnType<typeof openDb>;
let db: Db;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  db = openDb(":memory:");
  __resetJobQueuesForTests();
  __resetJobsForTests();
});

afterEach(() => db.close());

describe("job family queue", () => {
  it("serializes jobs in the same family", async () => {
    const first = deferred();
    const events: string[] = [];
    enqueue("maintenance", "one", async () => {
      events.push("start:one");
      await first.promise;
      events.push("finish:one");
    });
    enqueue("maintenance", "two", async () => {
      events.push("start:two");
    });

    await flush();
    expect(events).toEqual(["start:one"]);
    first.resolve();
    await flush();
    expect(events).toEqual(["start:one", "finish:one", "start:two"]);
  });

  it("runs different families independently", async () => {
    const slow = deferred();
    const events: string[] = [];
    enqueue("meetings", "slow", async () => {
      events.push("meetings:start");
      await slow.promise;
    });
    enqueue("maintenance", "fast", async () => {
      events.push("maintenance:start");
    });

    await flush();
    expect(events).toEqual(["meetings:start", "maintenance:start"]);
    slow.resolve();
  });

  it("continues after a rejected runner", async () => {
    const run = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("boom");
    });
    enqueue("maintenance", "bad", run);
    enqueue("maintenance", "good", run);
    await flush();
    await flush();
    expect(run.mock.calls.map(([id]) => id)).toEqual(["bad", "good"]);
  });
});

describe("bootJobs", () => {
  it("requeues stuck jobs with their persisted cursor", async () => {
    const run = vi.fn(async (name: string) => {
      expect(getCursor(db, name)).toBe("cursor-42");
    });
    registerJob({ name: "meetings-poll", flag: "MEETINGS_ENABLED", family: "meetings", run: async () => undefined });
    recordStart(db, "meetings-poll", "2026-07-11T10:00:00.000Z");
    setCursor(db, "meetings-poll", "cursor-42");

    bootJobs(db, run);
    await flush();

    expect(run).toHaveBeenCalledWith("meetings-poll");
    expect(getLatestRun(db, "meetings-poll")).toMatchObject({
      status: "failed",
      detail: "requeued after process restart",
    });
  });

  it("ignores stuck rows for jobs not present in the registry", async () => {
    const run = vi.fn(async () => undefined);
    recordStart(db, "removed-job", "2026-07-11T10:00:00.000Z");
    bootJobs(db, run);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
