import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { insertProposed } from "./tasks";
import { addComment, countsForTasks, deleteComment, editComment, getComment, listComments } from "./task-comments";

let db: DatabaseType;

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

// The comment rows carry a real foreign key, so a task has to exist first.
// `insertProposed` takes the id, which keeps these fixtures addressable by name.
function seedTask(id: string): void {
  insertProposed(db, {
    id,
    title: `Task ${id}`,
    description: "d",
    assigneeEmail: null,
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["exec"],
    due: null,
    origin: "manual",
    createdAt: "2026-08-07T00:00:00.000Z",
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  seedTask("t1");
  seedTask("t2");
});

describe("task comments", () => {
  it("adds and lists oldest first", () => {
    addComment(db, { id: "c2", taskId: "t1", authorEmail: ALICE, body: "second", createdAt: "2026-08-07T00:02:00.000Z" });
    addComment(db, { id: "c1", taskId: "t1", authorEmail: BOB, body: "first", createdAt: "2026-08-07T00:01:00.000Z" });

    const comments = listComments(db, "t1");
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(comments[0]).toMatchObject({ taskId: "t1", authorEmail: BOB, body: "first", editedAt: null });
  });

  it("normalizes the author email on write", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: "  Alice@Example.COM ", body: "hi", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(listComments(db, "t1")[0].authorEmail).toBe(ALICE);
  });

  it("lists only the requested task", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "one", createdAt: "2026-08-07T00:01:00.000Z" });
    addComment(db, { id: "c2", taskId: "t2", authorEmail: ALICE, body: "two", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(listComments(db, "t1").map((c) => c.id)).toEqual(["c1"]);
  });

  it("edits own comment and stamps edited_at", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "old", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(editComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "new", editedAt: "2026-08-07T00:05:00.000Z" })).toBe(true);
    expect(listComments(db, "t1")[0]).toMatchObject({ body: "new", editedAt: "2026-08-07T00:05:00.000Z" });
  });

  it("refuses to edit someone else's comment and changes nothing", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "old", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(editComment(db, { id: "c1", taskId: "t1", authorEmail: BOB, body: "hijacked", editedAt: "2026-08-07T00:05:00.000Z" })).toBe(false);
    expect(listComments(db, "t1")[0].body).toBe("old");
  });

  it("refuses to edit through the wrong task id", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "old", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(editComment(db, { id: "c1", taskId: "t2", authorEmail: ALICE, body: "hijacked", editedAt: "2026-08-07T00:05:00.000Z" })).toBe(false);
    expect(listComments(db, "t1")[0].body).toBe("old");
  });

  it("deletes own comment, refuses another author's, and deletes any when authorEmail is null", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "a", createdAt: "2026-08-07T00:01:00.000Z" });
    addComment(db, { id: "c2", taskId: "t1", authorEmail: BOB, body: "b", createdAt: "2026-08-07T00:02:00.000Z" });

    expect(deleteComment(db, { id: "c2", taskId: "t1", authorEmail: ALICE })).toBe(false);
    expect(deleteComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE })).toBe(true);
    expect(deleteComment(db, { id: "c2", taskId: "t1", authorEmail: null })).toBe(true);
    expect(listComments(db, "t1")).toEqual([]);
  });

  it("refuses to delete through the wrong task id", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "a", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(deleteComment(db, { id: "c1", taskId: "t2", authorEmail: null })).toBe(false);
    expect(listComments(db, "t1")).toHaveLength(1);
  });

  it("counts per task, omitting tasks with none, and returns {} for no ids", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "a", createdAt: "2026-08-07T00:01:00.000Z" });
    addComment(db, { id: "c2", taskId: "t1", authorEmail: BOB, body: "b", createdAt: "2026-08-07T00:02:00.000Z" });

    expect(countsForTasks(db, ["t1", "t2"])).toEqual({ t1: 2 });
    expect(countsForTasks(db, [])).toEqual({});
  });

  it("tolerates duplicate ids in the count request", () => {
    addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "a", createdAt: "2026-08-07T00:01:00.000Z" });
    expect(countsForTasks(db, ["t1", "t1"])).toEqual({ t1: 1 });
  });

  describe("getComment", () => {
    it("returns the comment when it belongs to the given task", () => {
      addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "hi", createdAt: "2026-08-07T00:01:00.000Z" });
      expect(getComment(db, "c1", "t1")).toMatchObject({ id: "c1", taskId: "t1", authorEmail: ALICE, body: "hi" });
    });

    it("returns null for an unknown id", () => {
      expect(getComment(db, "nope", "t1")).toBeNull();
    });

    it("returns null when the id is real but belongs to a different task", () => {
      addComment(db, { id: "c1", taskId: "t1", authorEmail: ALICE, body: "hi", createdAt: "2026-08-07T00:01:00.000Z" });
      expect(getComment(db, "c1", "t2")).toBeNull();
    });
  });
});
