import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetJobsForTests, getJob, hasJob, registerJob } from "./registry";

beforeEach(__resetJobsForTests);

describe("job registry", () => {
  it("registers and resolves a job by name", () => {
    const run = vi.fn(async () => ({ detail: "done" }));
    registerJob({ name: "refresh", flag: null, family: "maintenance", run });

    expect(getJob("refresh")).toEqual({
      name: "refresh",
      flag: null,
      family: "maintenance",
      run,
    });
  });

  it("returns undefined for an unknown job", () => {
    expect(getJob("missing")).toBeUndefined();
  });

  it("lazily provides the meetings poll handler", () => {
    expect(getJob("meetings-poll")).toMatchObject({
      name: "meetings-poll",
      flag: "MEETINGS_ENABLED",
      family: "meetings",
    });
  });

  it("hasJob does not lazily create the meetings poll handler", () => {
    expect(hasJob("meetings-poll")).toBe(false);
    getJob("meetings-poll");
    expect(hasJob("meetings-poll")).toBe(true);
  });

  it("hasJob reports a registered job", () => {
    expect(hasJob("refresh")).toBe(false);
    registerJob({ name: "refresh", flag: null, family: "maintenance", run: vi.fn(async () => undefined) });
    expect(hasJob("refresh")).toBe(true);
  });

  it("rejects duplicate names", () => {
    const job = {
      name: "refresh",
      flag: null,
      family: "maintenance",
      run: vi.fn(async () => undefined),
    };
    registerJob(job);
    expect(() => registerJob(job)).toThrow(/already registered/);
  });
});
