import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import {
  getCursor,
  getLatestRun,
  listProcessingJobs,
  recordFinish,
  recordStart,
  setCursor,
} from "./state";

type Db = ReturnType<typeof openDb>;
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => db.close());

describe("job state", () => {
  it("records a start and successful finish", () => {
    const runId = recordStart(db, "repo-refresh", "2026-07-11T10:00:00.000Z");
    recordFinish(db, runId, "succeeded", "updated", "2026-07-11T10:01:00.000Z");

    expect(getLatestRun(db, "repo-refresh")).toEqual({
      id: runId,
      job: "repo-refresh",
      startedAt: "2026-07-11T10:00:00.000Z",
      finishedAt: "2026-07-11T10:01:00.000Z",
      status: "succeeded",
      detail: "updated",
    });
  });

  it("lists jobs left processing", () => {
    recordStart(db, "meetings-poll", "2026-07-11T10:00:00.000Z");
    const completeId = recordStart(db, "repo-refresh", "2026-07-11T10:01:00.000Z");
    recordFinish(db, completeId, "failed", "network", "2026-07-11T10:02:00.000Z");

    expect(listProcessingJobs(db)).toEqual(["meetings-poll"]);
  });

  it("gets and upserts string cursors", () => {
    expect(getCursor(db, "meetings.last_ingest_at")).toBeNull();
    setCursor(db, "meetings.last_ingest_at", "first");
    setCursor(db, "meetings.last_ingest_at", "second");
    expect(getCursor(db, "meetings.last_ingest_at")).toBe("second");
  });
});
