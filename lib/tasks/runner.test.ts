import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { listByMeeting, setStatus } from "@/lib/db/tasks";
import type { ActionItem } from "@/lib/meetings/circleback";
import { extractTasksForMeeting } from "./runner";
import { resolveAssignee } from "./resolve";
import { seedFromMeeting } from "./seed";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
});

function actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    externalId: "cb-1",
    title: "Send the revised deck",
    description: "Send the revised deck to reviewers.",
    assigneeName: "Alice Chen",
    assigneeEmail: "alice@example.com",
    done: false,
    ...overrides,
  };
}

function dependencies() {
  return {
    db,
    seed: vi.fn(seedFromMeeting),
    resolve: vi.fn(resolveAssignee),
    loadGroups: vi.fn(() => ({ exec: ["alice@example.com", "bob@example.com"] })),
    loadAliases: vi.fn(() => ({})),
    fetchActionItems: vi.fn(async () => [actionItem()]),
    now: () => "2026-07-11T12:00:00Z",
  };
}

function context(actionItems: ActionItem[], attendees = ["alice@example.com", "dana@outside.test"]) {
  return { notePath: "docs/meetings/2026/review.md", visibility: ["exec"], attendees, actionItems };
}

describe("extractTasksForMeeting", () => {
  it("creates proposed tasks with clearance inherited exactly", async () => {
    const deps = dependencies();
    await expect(extractTasksForMeeting("m1", context([actionItem()]), deps)).resolves.toBeUndefined();

    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{
      title: "Send the revised deck",
      description: "Send the revised deck to reviewers.",
      status: "proposed",
      clearance: ["exec"],
      assigneeEmail: "alice@example.com",
      due: null,
    }]);
  });

  it("stamps the meeting's attendees onto the task, including the ones no group knows", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([actionItem()]), deps);

    // dana is in no group, so she fails the clearance intersection on every read
    // path. Recording her here is what lets her see the action item at all.
    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{
      sourceAttendees: ["alice@example.com", "dana@outside.test"],
    }]);
  });

  it("records no attendees when the meeting had none, leaving clearance in charge", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([actionItem()], []), deps);
    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{ sourceAttendees: [] }]);
  });

  it("creates a task for every attendee, not only the account holder", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([
      actionItem({ externalId: "cb-1", assigneeName: "Alice Chen", assigneeEmail: "alice@example.com" }),
      actionItem({ externalId: "cb-2", assigneeName: "Bob Ortiz", assigneeEmail: "bob@example.com" }),
    ]), deps);

    expect(listByMeeting(db, "circleback:m1").map((task) => task.assigneeEmail).sort())
      .toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("is idempotent and does not recreate dismissed tasks", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([actionItem()]), deps);
    const first = listByMeeting(db, "circleback:m1")[0];
    setStatus(db, first.id, "dismissed");
    await extractTasksForMeeting("m1", context([actionItem()]), deps);
    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{ id: first.id, status: "dismissed" }]);
  });

  it("does not duplicate a task when Circleback rewords the title", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([actionItem()]), deps);
    await extractTasksForMeeting("m1", context([actionItem({ title: "Send the revised deck to reviewers" })]), deps);
    expect(listByMeeting(db, "circleback:m1")).toHaveLength(1);
  });

  it("leaves an item unassigned when the assignee is not a known member", async () => {
    const deps = dependencies();
    await extractTasksForMeeting("m1", context([actionItem({ assigneeEmail: "vendor@outside.test" })]), deps);
    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{ assigneeEmail: null }]);
  });

  it("does nothing with the flag off", async () => {
    const deps = dependencies();
    delete process.env.TASKS_ENABLED;
    await extractTasksForMeeting("m1", context([actionItem()]), deps);
    expect(deps.seed).not.toHaveBeenCalled();
  });

  it("never throws when the meeting lookup fails on the re-run path", async () => {
    const deps = dependencies();
    deps.fetchActionItems.mockRejectedValueOnce(new Error("Circleback unavailable"));
    await expect(extractTasksForMeeting("m1", undefined, deps)).resolves.toBeUndefined();
    expect(listByMeeting(db, "circleback:m1")).toEqual([]);
  });
});
