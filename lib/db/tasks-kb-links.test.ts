import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  createManualTask,
  insertProposed,
  listKbAnchoredTasks,
  listVisibleByMeeting,
  setStatus,
  type ProposedTask,
} from "./tasks";

/**
 * The two KB-surface queries (spec 2026-08-17-kb-task-links-design), in their
 * own file because `tasks.test.ts` sits at the file-size threshold.
 */

let db: DatabaseType;

const proposed = (overrides: Partial<ProposedTask> & { id: string }): ProposedTask => ({
  title: "Publish the summary",
  description: "Publish the reviewed meeting summary.",
  assigneeEmail: null,
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/2026/review-m1.md",
  clearance: ["exec"],
  due: null,
  origin: "circleback",
  createdAt: "2026-08-17T12:00:00Z",
  ...overrides,
});

beforeEach(() => {
  db = openDb(":memory:");
});

describe("listKbAnchoredTasks", () => {
  it("returns sourced, cleared, non-dismissed tasks in the overlay's shape", () => {
    insertProposed(db, proposed({ id: "task-a" }));

    expect(listKbAnchoredTasks(db, ["exec", "all-hands"])).toEqual([
      { id: "task-a", title: "Publish the summary", sourceNotePath: "docs/meetings/2026/review-m1.md" },
    ]);
  });

  it("filters by group intersection, so an uncleared requester gets nothing", () => {
    insertProposed(db, proposed({ id: "task-a" }));

    expect(listKbAnchoredTasks(db, ["ops"])).toEqual([]);
  });

  it("excludes dismissed tasks and tasks with no source note", () => {
    insertProposed(db, proposed({ id: "task-a" }));
    setStatus(db, "task-a", "dismissed");
    createManualTask(db, {
      title: "Manual chore",
      description: "No meeting behind this.",
      assignees: [],
      clearance: ["exec"],
      due: null,
      createdBy: "alice@example.com",
      createdAt: "2026-08-17T12:00:00Z",
    });

    expect(listKbAnchoredTasks(db, ["exec"])).toEqual([]);
  });

  it("includes done tasks: a completed item is still part of what the meeting produced", () => {
    insertProposed(db, proposed({ id: "task-a", assigneeEmail: "alice@example.com" }));
    setStatus(db, "task-a", "done");

    expect(listKbAnchoredTasks(db, ["exec"]).map((task) => task.id)).toEqual(["task-a"]);
  });

  it("never throws: a broken handle degrades to an empty overlay", () => {
    db.close();

    expect(listKbAnchoredTasks(db, ["exec"])).toEqual([]);
  });
});

describe("listVisibleByMeeting", () => {
  it("returns the meeting's tasks to a requester the clearance covers", () => {
    insertProposed(db, proposed({ id: "task-a" }));
    insertProposed(db, proposed({ id: "task-b", sourceMeetingId: "circleback:m2" }));

    const tasks = listVisibleByMeeting(db, "circleback:m1", "carol@example.com", ["exec"]);

    expect(tasks.map((task) => task.id)).toEqual(["task-a"]);
  });

  it("admits a recorded attendee whose clearance does not cover the task", () => {
    insertProposed(db, proposed({ id: "task-a", sourceAttendees: ["bob@example.com"] }));

    const tasks = listVisibleByMeeting(db, "circleback:m1", "bob@example.com", ["other"]);

    expect(tasks.map((task) => task.id)).toEqual(["task-a"]);
  });

  it("refuses an outsider: not cleared, not in the room", () => {
    insertProposed(db, proposed({ id: "task-a", sourceAttendees: ["bob@example.com"] }));

    expect(listVisibleByMeeting(db, "circleback:m1", "dana@example.com", ["other"])).toEqual([]);
  });
});
