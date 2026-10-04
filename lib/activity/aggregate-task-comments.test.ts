import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authority/aliases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/aliases")>();
  return { ...actual, aliasIndex: () => ({}) };
});

const { newSince } = await import("./aggregate");
const { openDb } = await import("@/lib/db/client");
const { insertProposed } = await import("@/lib/db/tasks");
const { addComment } = await import("@/lib/db/task-comments");

let db: import("better-sqlite3").Database;

const ME = "me@example.com";
const OTHER = "other@example.com";
const EXEC = ["exec"];
const CURSOR = "2026-08-07T00:00:00.000Z";
const LATER = "2026-08-07T01:00:00.000Z";

function seedTask(
  id: string,
  overrides: { assigneeEmail?: string | null; createdBy?: string | null; clearance?: string[] } = {},
): void {
  insertProposed(db, {
    id,
    title: `Task ${id}`,
    description: "d",
    assigneeEmail: overrides.assigneeEmail ?? null,
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: overrides.clearance ?? EXEC,
    due: null,
    origin: "manual",
    createdAt: CURSOR,
  });
  if (overrides.createdBy) {
    db.prepare(`UPDATE tasks SET created_by = @by WHERE id = @id`).run({ by: overrides.createdBy, id });
  }
}

function comment(id: string, taskId: string, author: string, body = "a thought", at = LATER): void {
  addComment(db, { id, taskId, authorEmail: author, body, createdAt: at });
}

function feed(clearance: string[] = EXEC) {
  return newSince(db, ME, clearance, CURSOR);
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.ACTIVITY_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.TASK_COMMENTS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.ACTIVITY_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("newSince: task comments", () => {
  it("includes a comment on a task assigned to you", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("c1", "t1", OTHER);
    expect(feed().taskComments.map((i) => i.id)).toEqual(["c1"]);
  });

  it("includes a comment on a task you created", () => {
    seedTask("t1", { createdBy: ME });
    comment("c1", "t1", OTHER);
    expect(feed().taskComments.map((i) => i.id)).toEqual(["c1"]);
  });

  it("includes a comment on a task you have already commented on", () => {
    seedTask("t1");
    comment("mine", "t1", ME, "my earlier thought", CURSOR);
    comment("c1", "t1", OTHER);
    expect(feed().taskComments.map((i) => i.id)).toEqual(["c1"]);
  });

  it("includes a comment that mentions you on a task you are unrelated to", () => {
    seedTask("t1");
    comment("c1", "t1", OTHER, `what do you think @${ME}?`);
    expect(feed().taskComments.map((i) => i.id)).toEqual(["c1"]);
  });

  it("excludes a comment on a task you are unrelated to and not mentioned in", () => {
    seedTask("t1");
    comment("c1", "t1", OTHER);
    expect(feed().taskComments).toEqual([]);
  });

  it("excludes your own comment on your own task", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("c1", "t1", ME);
    expect(feed().taskComments).toEqual([]);
  });

  it("excludes a comment outside your clearance even when it mentions you", () => {
    seedTask("t1", { clearance: ["board"] });
    comment("c1", "t1", OTHER, `hey @${ME}`);
    expect(feed().taskComments).toEqual([]);
  });

  it("excludes a comment at or before the cursor", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("old", "t1", OTHER, "a thought", CURSOR);
    expect(feed().taskComments).toEqual([]);
  });

  it("points at the task detail page and carries the task's title and visibility", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("c1", "t1", OTHER);
    expect(feed().taskComments[0]).toMatchObject({
      title: "Task t1",
      href: "/tasks/t1",
      createdAt: LATER,
      visibility: "restricted",
      group: "Exec",
    });
  });

  it("counts into unreadCount", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("c1", "t1", OTHER);
    const result = feed();
    expect(result.unreadCount).toBe(
      result.tasks.length + result.meetings.length + result.sharedDocs.length + 1,
    );
  });

  it("is empty when the flag is off", () => {
    seedTask("t1", { assigneeEmail: ME });
    comment("c1", "t1", OTHER);
    delete process.env.TASK_COMMENTS_ENABLED;
    expect(feed().taskComments).toEqual([]);
  });
});
