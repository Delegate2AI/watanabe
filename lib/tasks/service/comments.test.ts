import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "tasks-comments-no-roles") };
});

const { openDb } = await import("@/lib/db/client");
const { insertProposed } = await import("@/lib/db/tasks");
const { addComment, getComment, listComments } = await import("@/lib/db/task-comments");
const { actorFor } = await import("@/lib/service/actor");
const { listTaskComments, addTaskComment, editTaskComment, deleteTaskComment } = await import("./comments");

const GROUPS = {
  exec: ["alice@example.com", "bob@example.com", "admin@example.com"],
  research: ["carol@example.com"],
};

let db: import("better-sqlite3").Database;

function ctxFor(email: string) {
  return { db, actor: actorFor(email, GROUPS) };
}

const PROPOSED = {
  description: "D",
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/m1.md",
  clearance: ["exec"],
  due: null,
  origin: "circleback" as const,
  createdAt: "2026-07-11T12:00:00Z",
};

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.TASK_COMMENTS_ENABLED = "1";
  delete process.env.ROLES_ENABLED;
  delete process.env.BOOTSTRAP_ADMINS;
  insertProposed(db, { ...PROPOSED, id: "task", title: "Task", assigneeEmail: null });
  insertProposed(db, { ...PROPOSED, id: "other", title: "Other", assigneeEmail: null });
  addComment(db, {
    id: "c-alice",
    taskId: "task",
    authorEmail: "alice@example.com",
    body: "Alice said this",
    createdAt: "2026-07-11T12:01:00Z",
  });
  addComment(db, {
    id: "c-elsewhere",
    taskId: "other",
    authorEmail: "alice@example.com",
    body: "On the other task",
    createdAt: "2026-07-11T12:02:00Z",
  });
});

afterEach(() => {
  for (const key of ["MEETINGS_ENABLED", "TASKS_ENABLED", "TASK_COMMENTS_ENABLED", "ROLES_ENABLED", "BOOTSTRAP_ADMINS"]) {
    delete process.env[key];
  }
});

describe("the shared flag gate", () => {
  it.each(["TASKS_ENABLED", "TASK_COMMENTS_ENABLED"])("is not found with %s off, on every verb", (flag) => {
    delete process.env[flag];
    const ctx = ctxFor("alice@example.com");
    const gone = { ok: false, code: "not_found" };

    expect(listTaskComments(ctx, "task")).toEqual(gone);
    expect(addTaskComment(ctx, "task", { body: "hi" })).toEqual(gone);
    expect(editTaskComment(ctx, "task", "c-alice", { body: "hi" })).toEqual(gone);
    expect(deleteTaskComment(ctx, "task", "c-alice")).toEqual(gone);
  });

  it("hides the whole thread from someone who cannot reach the task", () => {
    expect(listTaskComments(ctxFor("carol@example.com"), "task")).toEqual({ ok: false, code: "not_found" });
  });
});

describe("listTaskComments", () => {
  it("returns the task's own comments and nobody else's task's", () => {
    const result = listTaskComments(ctxFor("bob@example.com"), "task");

    expect(result.ok && result.value.comments.map((c) => c.id)).toEqual(["c-alice"]);
  });
});

describe("addTaskComment", () => {
  it("writes a comment attributed to the caller", () => {
    const result = addTaskComment(ctxFor("bob@example.com"), "task", { body: " Something " }, "2026-09-04T10:00:00Z");

    expect(result.ok && result.value.comment.authorEmail).toBe("bob@example.com");
    expect(result.ok && result.value.comment.body).toBe("Something");
    expect(listComments(db, "task")).toHaveLength(2);
  });

  it.each([
    ["a whitespace-only body", { body: "   " }],
    ["a body over the cap", { body: "x".repeat(10_001) }],
    ["a missing body", {}],
  ])("refuses %s", (_label, body) => {
    expect(addTaskComment(ctxFor("alice@example.com"), "task", body)).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "body",
    });
  });

  it("accepts a body exactly at the cap", () => {
    expect(addTaskComment(ctxFor("alice@example.com"), "task", { body: "x".repeat(10_000) }).ok).toBe(true);
  });
});

describe("editTaskComment", () => {
  it("lets an author rewrite their own comment", () => {
    const result = editTaskComment(ctxFor("alice@example.com"), "task", "c-alice", { body: "Revised" });

    expect(result).toEqual({ ok: true, value: { changed: true } });
    expect(getComment(db, "c-alice", "task")?.body).toBe("Revised");
  });

  it("refuses a colleague, and leaves the stored body alone", () => {
    const result = editTaskComment(ctxFor("bob@example.com"), "task", "c-alice", { body: "Not mine to write" });

    expect(result).toEqual({ ok: false, code: "needs_role", detail: "author" });
    expect(getComment(db, "c-alice", "task")?.body).toBe("Alice said this");
  });

  // An administrator may remove a comment, never rewrite one and leave it
  // attributed to its author.
  it("refuses an administrator too", () => {
    process.env.BOOTSTRAP_ADMINS = "admin@example.com";

    expect(editTaskComment(ctxFor("admin@example.com"), "task", "c-alice", { body: "Edited" })).toEqual({
      ok: false,
      code: "needs_role",
      detail: "author",
    });
  });

  // The ordering that stops a 400-versus-404 difference being an existence
  // oracle. A malformed body is refused before anything is resolved, because it
  // answers identically for every id; an EMPTY body is refused only after the
  // gate, because by then the caller has already proved they can reach it.
  it("answers not-found for an empty body against a comment that is not there", () => {
    expect(editTaskComment(ctxFor("alice@example.com"), "task", "no-such-comment", { body: "  " })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("answers a bad request for an empty body against a comment the caller authored", () => {
    expect(editTaskComment(ctxFor("alice@example.com"), "task", "c-alice", { body: "  " })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "body",
    });
  });

  it("refuses a malformed body before it resolves anything, whatever the id", () => {
    const known = editTaskComment(ctxFor("alice@example.com"), "task", "c-alice", { body: 7 });
    const unknown = editTaskComment(ctxFor("alice@example.com"), "task", "no-such-comment", { body: 7 });

    expect(known).toEqual({ ok: false, code: "invalid_request", detail: "body" });
    expect(known).toEqual(unknown);
  });

  it("will not reach a comment id that belongs to another task", () => {
    expect(editTaskComment(ctxFor("alice@example.com"), "task", "c-elsewhere", { body: "Moved" })).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(getComment(db, "c-elsewhere", "other")?.body).toBe("On the other task");
  });
});

describe("deleteTaskComment", () => {
  it("lets an author remove their own", () => {
    expect(deleteTaskComment(ctxFor("alice@example.com"), "task", "c-alice")).toEqual({
      ok: true,
      value: { changed: true },
    });
    expect(listComments(db, "task")).toHaveLength(0);
  });

  it("lets an administrator remove somebody else's", () => {
    process.env.BOOTSTRAP_ADMINS = "admin@example.com";

    expect(deleteTaskComment(ctxFor("admin@example.com"), "task", "c-alice")).toEqual({
      ok: true,
      value: { changed: true },
    });
    expect(listComments(db, "task")).toHaveLength(0);
  });

  it("refuses a cleared colleague who is neither author nor administrator", () => {
    expect(deleteTaskComment(ctxFor("bob@example.com"), "task", "c-alice")).toEqual({
      ok: false,
      code: "needs_role",
      detail: "author",
    });
    expect(listComments(db, "task")).toHaveLength(1);
  });

  it("will not reach across tasks even for an administrator", () => {
    process.env.BOOTSTRAP_ADMINS = "admin@example.com";

    expect(deleteTaskComment(ctxFor("admin@example.com"), "task", "c-elsewhere")).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(listComments(db, "other")).toHaveLength(1);
  });
});
