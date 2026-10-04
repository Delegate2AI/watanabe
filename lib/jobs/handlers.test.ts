import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { __resetJobsForTests, getJob, hasJob } from "./registry";
import { __resetJobQueuesForTests } from "./queue";
import { __resetDispatchForTests, dispatch, runJob } from "./dispatch";

vi.mock("@/lib/repo", () => ({
  refreshRepo: vi.fn(async () => {}),
}));

import { refreshRepo } from "@/lib/repo";
import { registerBuiltInJobs } from "./handlers";

type Db = ReturnType<typeof openDb>;
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  __resetJobsForTests();
  __resetJobQueuesForTests();
  __resetDispatchForTests();
  vi.mocked(refreshRepo).mockClear();
  delete process.env.AUTHORITY_ENABLED;
});

afterEach(() => {
  db.close();
  delete process.env.AUTHORITY_ENABLED;
});

describe("registerBuiltInJobs", () => {
  it("registers repo-refresh as a core, unflagged maintenance job", () => {
    registerBuiltInJobs(db);
    expect(getJob("repo-refresh")).toMatchObject({
      name: "repo-refresh",
      flag: null,
      family: "maintenance",
    });
  });

  it("registers reconcile gated by AUTHORITY_ENABLED", () => {
    registerBuiltInJobs(db);
    expect(getJob("reconcile")).toMatchObject({
      name: "reconcile",
      flag: "AUTHORITY_ENABLED",
      family: "maintenance",
    });
  });

  it("repo-refresh handler invokes refreshRepo", async () => {
    registerBuiltInJobs(db);
    const result = await runJob("repo-refresh", db);
    expect(refreshRepo).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "succeeded", detail: "checkout refreshed" });
  });

  it("reconcile handler is a no-op when AUTHORITY_ENABLED is off", async () => {
    registerBuiltInJobs(db);
    const result = await runJob("reconcile", db);
    expect(result).toMatchObject({
      status: "succeeded",
      detail: "authority disabled; reconcile skipped",
    });
  });

  it("reconcile handler emits a summary when AUTHORITY_ENABLED is on", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    registerBuiltInJobs(db);
    // Dispatched through runJob, reconcile's own run is "processing" while it
    // executes, so the summary counts itself as one in-flight job.
    const result = await runJob("reconcile", db);
    expect(result).toMatchObject({
      status: "succeeded",
      detail: "reconcile ok: 1 stuck job(s)",
    });
  });

  it("does not register meetings-poll (left lazy in getJob)", () => {
    registerBuiltInJobs(db);
    expect(hasJob("meetings-poll")).toBe(false);
  });

  it("is safe to call twice (idempotent, no duplicate-registration throw)", () => {
    registerBuiltInJobs(db);
    expect(() => registerBuiltInJobs(db)).not.toThrow();
    expect(getJob("repo-refresh")).toMatchObject({ name: "repo-refresh" });
    expect(getJob("reconcile")).toMatchObject({ name: "reconcile" });
  });

  it("registers meetings-retry-failed in the meetings family", () => {
    registerBuiltInJobs(db);
    expect(getJob("meetings-retry-failed")).toMatchObject({
      name: "meetings-retry-failed",
      flag: "MEETINGS_ENABLED",
      family: "meetings",
    });
  });

  it("does not dispatch meetings-retry-failed while the flag is off", () => {
    registerBuiltInJobs(db);
    delete process.env.MEETINGS_ENABLED;
    expect(dispatch("meetings-retry-failed", db)).toEqual({ status: "disabled" });
  });
});
