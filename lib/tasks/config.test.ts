import { afterEach, describe, expect, it } from "vitest";
import { isTasksEnabled, isTaskCommentsEnabled } from "./config";

afterEach(() => {
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("isTasksEnabled", () => {
  it("is on iff TASKS_ENABLED is 1, independent of meetings", () => {
    expect(isTasksEnabled()).toBe(false);
    process.env.TASKS_ENABLED = "1";
    expect(isTasksEnabled()).toBe(true);
    // Meetings being off no longer disables tasks (the board runs standalone).
    process.env.MEETINGS_ENABLED = "0";
    expect(isTasksEnabled()).toBe(true);
    delete process.env.TASKS_ENABLED;
    expect(isTasksEnabled()).toBe(false);
  });
});

describe("isTaskCommentsEnabled", () => {
  it("is off when the env var is absent", () => {
    expect(isTaskCommentsEnabled()).toBe(false);
  });

  it("is on when the env var is exactly 1", () => {
    process.env.TASK_COMMENTS_ENABLED = "1";
    expect(isTaskCommentsEnabled()).toBe(true);
  });

  it("is off for any other value", () => {
    process.env.TASK_COMMENTS_ENABLED = "true";
    expect(isTaskCommentsEnabled()).toBe(false);
  });
});
