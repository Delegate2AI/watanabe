import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { __resetJobsForTests, registerJob } from "@/lib/jobs/registry";
import { getLatestRun } from "@/lib/jobs/state";
import { runCli } from "./job";

type Db = ReturnType<typeof openDb>;
let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  __resetJobsForTests();
});

afterEach(() => db.close());

describe("job CLI", () => {
  it("runs a registered handler and prints its recorded outcome", async () => {
    registerJob({
      name: "repo-refresh",
      flag: null,
      family: "maintenance",
      run: async () => ({ detail: "refreshed" }),
    });
    const output = vi.fn();

    await expect(runCli(["repo-refresh"], { db, output, error: vi.fn() })).resolves.toBe(0);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      job: "repo-refresh",
      status: "succeeded",
      detail: "refreshed",
    });
    expect(getLatestRun(db, "repo-refresh")).toMatchObject({ status: "succeeded" });
  });

  it("rejects an unknown job", async () => {
    const error = vi.fn();
    await expect(runCli(["missing"], { db, output: vi.fn(), error })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith("unknown job: missing");
  });

  it("does not run a flag-disabled job", async () => {
    registerJob({
      name: "meetings-poll",
      flag: "MEETINGS_ENABLED",
      family: "meetings",
      run: async () => undefined,
    });
    const error = vi.fn();
    await expect(runCli(["meetings-poll"], { db, output: vi.fn(), error })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith("job disabled by MEETINGS_ENABLED: meetings-poll");
  });

  it.each([
    ["reconcile", "AUTHORITY_ENABLED"],
    ["meetings-retry-failed", "MEETINGS_ENABLED"],
  ])("resolves the built-in job %s without prior registration", async (name, flag) => {
    delete process.env[flag];
    const error = vi.fn();
    await expect(runCli([name], { db, output: vi.fn(), error })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(`job disabled by ${flag}: ${name}`);
  });

  it("can resolve built-in jobs repeatedly without throwing", async () => {
    const error = vi.fn();
    await runCli(["reconcile"], { db, output: vi.fn(), error });
    await expect(runCli(["reconcile"], { db, output: vi.fn(), error })).resolves.toBe(1);
    expect(error).not.toHaveBeenCalledWith("unknown job: reconcile");
  });
});
