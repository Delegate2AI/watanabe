import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the roles file location is pinned, so `can` cannot pick up whatever the
// developer's worktree happens to hold. Groups are handed to the actor directly.
vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "tasks-service-no-roles") };
});

const { openDb } = await import("@/lib/db/client");
const { insertProposed, getVisibleTask } = await import("@/lib/db/tasks");
const { actorFor } = await import("@/lib/service/actor");
const { listTasks, getTask, createTask } = await import("./tasks");

const GROUPS = {
  exec: ["alice@example.com", "bob@example.com"],
  research: ["carol@example.com"],
};

let db: import("better-sqlite3").Database;

function ctxFor(email: string) {
  return { db, actor: actorFor(email, GROUPS) };
}

const PROPOSED = {
  description: "Description",
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
  insertProposed(db, { ...PROPOSED, id: "mine", title: "Mine", assigneeEmail: "alice@example.com" });
  insertProposed(db, { ...PROPOSED, id: "foreign", title: "Foreign", assigneeEmail: "bob@example.com" });
  insertProposed(db, { ...PROPOSED, id: "triage", title: "Triage", assigneeEmail: null });
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
});

describe("listTasks", () => {
  // getForRequester composes visibleWhere: cleared AND (assigned to me OR
  // unassigned). It is one of three predicates that are NOT interchangeable, and
  // picking the wrong one is silent rather than a crash.
  it("returns the caller's own tasks and cleared triage, and nobody else's", () => {
    const result = listTasks(ctxFor("alice@example.com"));

    expect(result.ok && result.value.tasks.map((t) => t.id).sort()).toEqual(["mine", "triage"]);
  });

  it("answers an empty surface, not a failure, when the subsystem is off", () => {
    delete process.env.TASKS_ENABLED;

    expect(listTasks(ctxFor("alice@example.com"))).toEqual({ ok: true, value: { tasks: [] } });
  });

  it("caps at the requested limit, and returns everything without one", () => {
    const capped = listTasks(ctxFor("alice@example.com"), { limit: 1 });
    const uncapped = listTasks(ctxFor("alice@example.com"));

    expect(capped.ok && capped.value.tasks).toHaveLength(1);
    expect(uncapped.ok && uncapped.value.tasks).toHaveLength(2);
  });

  it("refuses a limit outside the accepted range rather than clamping it", () => {
    expect(listTasks(ctxFor("alice@example.com"), { limit: 9999 })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "body",
    });
  });
});

describe("getTask", () => {
  // The no-oracle property: a task that is not there and a task this caller may
  // not see have to be one answer, not two distinguishable ones.
  it("gives an unreachable task and an invented id the identical failure", () => {
    const unreachable = getTask(ctxFor("carol@example.com"), "mine");
    const invented = getTask(ctxFor("carol@example.com"), "no-such-task");

    expect(unreachable).toEqual({ ok: false, code: "not_found" });
    expect(unreachable).toEqual(invented);
  });

  // getVisibleTask uses clearanceWhere, not visibleWhere. A cleared colleague
  // opens a task assigned to someone else; the list above deliberately does not
  // show it to them. Both are correct and they must not be collapsed.
  it("opens a cleared task the caller is not assigned to", () => {
    const result = getTask(ctxFor("alice@example.com"), "foreign");

    expect(result.ok && result.value.task.id).toBe("foreign");
  });

  // Attendance is a grant in its own right, mirrored in SQL and again in the
  // transition guard. Someone who sat in the meeting reaches its task even when
  // their groups do not intersect the task's clearance.
  it("opens a task for a recorded attendee whose groups do not intersect it", () => {
    insertProposed(db, {
      ...PROPOSED,
      id: "attended",
      title: "Attended",
      assigneeEmail: null,
      clearance: ["board"],
      sourceAttendees: ["carol@example.com"],
    });

    expect(getTask(ctxFor("carol@example.com"), "attended").ok).toBe(true);
    expect(getTask(ctxFor("alice@example.com"), "attended")).toEqual({ ok: false, code: "not_found" });
  });

  it("is not found when the subsystem is off, whatever the id", () => {
    delete process.env.TASKS_ENABLED;

    expect(getTask(ctxFor("alice@example.com"), "mine")).toEqual({ ok: false, code: "not_found" });
  });
});

describe("createTask", () => {
  const VALID = { title: "Write spec", clearance: "exec" };

  it("creates for a group the caller belongs to", () => {
    const result = createTask(ctxFor("alice@example.com"), VALID, "2026-09-04T10:00:00Z");

    expect(result.ok && result.value.task.status).toBe("open");
    expect(result.ok && result.value.task.origin).toBe("manual");
    expect(result.ok && result.value.task.createdBy).toBe("alice@example.com");
    expect(result.ok && result.value.task.createdAt).toBe("2026-09-04T10:00:00Z");
  });

  it("refuses a clearance group the caller is not in", () => {
    expect(createTask(ctxFor("alice@example.com"), { title: "T", clearance: "research" })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "clearance",
    });
  });

  it("refuses an assignee who is on no roster", () => {
    const result = createTask(ctxFor("alice@example.com"), { ...VALID, assigneeEmail: "stranger@example.com" });

    expect(result).toEqual({ ok: false, code: "invalid_request", detail: "assigneeEmail" });
  });

  // assignee_email must always equal assignees[0]. Only assigneeWrite maintains
  // that pair, so any path that touches one column has to go through it.
  it("dedupes and normalizes assignees, keeping the first as the primary", () => {
    const result = createTask(ctxFor("alice@example.com"), {
      ...VALID,
      assignees: ["Bob@example.com", "bob@example.com", "alice@example.com"],
    });

    expect(result.ok).toBe(true);
    const stored = result.ok ? getVisibleTask(db, result.value.task.id, "alice@example.com", ["all-hands", "exec"]) : null;
    expect(stored?.assignees).toEqual(["bob@example.com", "alice@example.com"]);
    expect(stored?.assigneeEmail).toBe("bob@example.com");
  });

  it.each([
    ["a blank title", { title: "   ", clearance: "exec" }],
    ["a missing title", { clearance: "exec" }],
    ["a missing clearance", { title: "T" }],
    ["a non-object body", 7],
    ["more than twenty assignees", { title: "T", clearance: "exec", assignees: Array.from({ length: 21 }, (_, i) => `p${i}@example.com`) }],
  ])("refuses %s", (_label, body) => {
    expect(createTask(ctxFor("alice@example.com"), body)).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "body",
    });
  });

  // The flag is checked before the parse, so a caller cannot tell a disabled
  // subsystem from a rejected body.
  it("is not found, not a bad request, when the subsystem is off and the body is malformed", () => {
    delete process.env.TASKS_ENABLED;

    expect(createTask(ctxFor("alice@example.com"), { nonsense: true })).toEqual({ ok: false, code: "not_found" });
  });
});
