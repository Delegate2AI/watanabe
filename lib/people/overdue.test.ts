import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@/lib/db/tasks";
import { isTaskOverdue, todayFrom } from "./overdue";

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "t1",
    title: "Task",
    description: "Description",
    assigneeEmail: "ken@example.com",
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    sourceAttendees: [],
    status: "open",
    due: null,
    origin: "manual",
    createdBy: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

const TODAY = "2026-08-05";

describe("todayFrom", () => {
  it("reduces an instant to the calendar day an overdue check works at", () => {
    // Constructed from local parts so the expectation holds in any timezone.
    expect(todayFrom(new Date(2026, 7, 5, 12, 0, 0))).toBe("2026-08-05");
  });

  it("pads single-digit months and days so the string sorts correctly", () => {
    expect(todayFrom(new Date(2026, 0, 9, 12, 0, 0))).toBe("2026-01-09");
  });

  it("reads the local calendar day, not the UTC one", () => {
    // Late evening local time is already tomorrow in UTC for western offsets.
    // Taking the UTC day here would mark a task due today as overdue, while the
    // task's own due label (which compares local days) still says "today".
    const lateLocal = new Date(2026, 7, 4, 22, 0, 0);
    expect(todayFrom(lateLocal)).toBe("2026-08-04");
    expect(isTaskOverdue(task({ due: "2026-08-04" }), todayFrom(lateLocal))).toBe(false);
  });
});

describe("isTaskOverdue", () => {
  it("is false for a task with no due date", () => {
    expect(isTaskOverdue(task({ due: null }), TODAY)).toBe(false);
  });

  it("is false for a task due today, since the day is not over", () => {
    expect(isTaskOverdue(task({ due: TODAY }), TODAY)).toBe(false);
  });

  it("is true for a task due before today", () => {
    expect(isTaskOverdue(task({ due: "2026-08-04" }), TODAY)).toBe(true);
  });

  it("is false once the task is done, however late it was", () => {
    expect(isTaskOverdue(task({ due: "2020-01-01", status: "done" }), TODAY)).toBe(false);
  });

  it("compares the calendar day when the due date is stored as a full instant", () => {
    // A due date written as an instant earlier in the same day must not read as
    // overdue: string-comparing it whole would make "2026-08-05T09:00:00.000Z"
    // sort before "2026-08-05" and report a task due today as already late.
    expect(isTaskOverdue(task({ due: "2026-08-05T09:00:00.000Z" }), TODAY)).toBe(false);
    expect(isTaskOverdue(task({ due: "2026-08-04T09:00:00.000Z" }), TODAY)).toBe(true);
  });

  it("still counts an in-progress task as overdue", () => {
    expect(isTaskOverdue(task({ due: "2026-08-01", status: "in_progress" }), TODAY)).toBe(true);
  });
});
