import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { __resetJobsForTests, registerJob } from "./registry";
import { __resetJobQueuesForTests } from "./queue";
import { dispatch, runJob, __resetDispatchForTests } from "./dispatch";
import { getLatestRun, recordStart } from "./state";

type Db = ReturnType<typeof openDb>;
let db: Db;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  db = openDb(":memory:");
  __resetJobsForTests();
  __resetJobQueuesForTests();
  __resetDispatchForTests();
  delete process.env.MEETINGS_ENABLED;
});

afterEach(() => {
  db.close();
  delete process.env.MEETINGS_ENABLED;
});

describe("dispatch", () => {
  it("returns unknown for a missing job", () => {
    expect(dispatch("missing", db)).toEqual({ status: "unknown" });
  });

  it("returns disabled without enqueueing when the job flag is off", async () => {
    const run = vi.fn(async () => undefined);
    registerJob({ name: "meetings-poll", flag: "MEETINGS_ENABLED", family: "meetings", run });

    expect(dispatch("meetings-poll", db)).toEqual({ status: "disabled" });
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it("enqueues an enabled job and returns before it completes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(() => pending);
    registerJob({ name: "repo-refresh", flag: null, family: "maintenance", run });

    expect(dispatch("repo-refresh", db)).toEqual({ status: "enqueued" });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(getLatestRun(db, "repo-refresh")).toMatchObject({ status: "processing" });
    release();
    await flush();
    expect(getLatestRun(db, "repo-refresh")).toMatchObject({ status: "succeeded" });
  });

  it("returns noop for a job already processing", () => {
    const run = vi.fn(async () => undefined);
    registerJob({ name: "repo-refresh", flag: null, family: "maintenance", run });
    recordStart(db, "repo-refresh");

    expect(dispatch("repo-refresh", db)).toEqual({ status: "noop" });
    expect(run).not.toHaveBeenCalled();
  });

  it("deduplicates a second trigger while the first is pending", () => {
    registerJob({ name: "repo-refresh", flag: null, family: "maintenance", run: async () => undefined });
    expect(dispatch("repo-refresh", db)).toEqual({ status: "enqueued" });
    expect(dispatch("repo-refresh", db)).toEqual({ status: "noop" });
  });
});

describe("runJob", () => {
  it("records handler failures and never rejects", async () => {
    registerJob({
      name: "reconcile",
      flag: null,
      family: "maintenance",
      run: async () => {
        throw new Error("broken");
      },
    });

    await expect(runJob("reconcile", db)).resolves.toMatchObject({ status: "failed" });
    expect(getLatestRun(db, "reconcile")).toMatchObject({
      status: "failed",
      detail: "Error: broken",
    });
  });

  it("stores handler detail on success", async () => {
    registerJob({
      name: "reconcile",
      flag: null,
      family: "maintenance",
      run: async () => ({ detail: "healthy" }),
    });
    await expect(runJob("reconcile", db)).resolves.toMatchObject({
      status: "succeeded",
      detail: "healthy",
    });
  });
});
