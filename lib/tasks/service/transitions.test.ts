import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The roles file location is pinned at a directory with nothing in it, so with
// ROLES_ENABLED on every address resolves to viewer and holds no capability.
// That is the state stage and prod are actually in.
vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "tasks-transitions-no-roles") };
});

const { openDb } = await import("@/lib/db/client");
const { insertProposed, createManualTask, getVisibleTask, setStatus, setVisibleStatus } = await import("@/lib/db/tasks");
const { actorFor } = await import("@/lib/service/actor");
const { transitionTask } = await import("./transitions");

const GROUPS = {
  exec: ["alice@example.com", "bob@example.com"],
  research: ["carol@example.com"],
};

const EXEC = ["all-hands", "exec"];
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

/** An open task created by alice and assigned to whoever is named. */
function openTask(id: string, assignees: string[], createdBy = "alice@example.com"): string {
  const task = createManualTask(db, {
    title: id,
    description: "",
    assignees,
    clearance: ["exec"],
    due: null,
    createdBy,
    createdAt: "2026-07-11T12:00:00Z",
  });
  return task.id;
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  delete process.env.ROLES_ENABLED;
  insertProposed(db, { ...PROPOSED, id: "triage", title: "Triage", assigneeEmail: null });
  insertProposed(db, { ...PROPOSED, id: "claimed", title: "Claimed", assigneeEmail: "bob@example.com" });
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.ROLES_ENABLED;
});

describe("transitionTask, reaching the task at all", () => {
  it("gives an uncleared task and an invented id the identical failure", () => {
    const uncleared = transitionTask(ctxFor("carol@example.com"), "triage", { action: "accept" });
    const invented = transitionTask(ctxFor("carol@example.com"), "no-such-task", { action: "accept" });

    expect(uncleared).toEqual({ ok: false, code: "not_found" });
    expect(uncleared).toEqual(invented);
  });

  it("is not found when the subsystem is off, before it looks at the body", () => {
    delete process.env.TASKS_ENABLED;

    expect(transitionTask(ctxFor("alice@example.com"), "triage", { nonsense: true })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("refuses a body that names no known action", () => {
    expect(transitionTask(ctxFor("alice@example.com"), "triage", { action: "explode" })).toEqual({
      ok: false,
      code: "invalid_request",
      detail: "body",
    });
  });
});

describe("transitionTask, lifecycle denials", () => {
  it("refuses anything but a move on a finished task, and everything on a dismissed one", () => {
    const done = openTask("done", ["alice@example.com"]);
    setStatus(db, done, "done");
    const dismissed = openTask("dismissed", ["alice@example.com"]);
    setStatus(db, dismissed, "dismissed");

    expect(transitionTask(ctxFor("alice@example.com"), done, { action: "complete" })).toEqual({
      ok: false,
      code: "terminal",
    });
    expect(transitionTask(ctxFor("alice@example.com"), dismissed, { action: "complete" })).toEqual({
      ok: false,
      code: "terminal",
    });
  });

  // canTransition deliberately mirrors assignTask's SQL preconditions
  // (status = 'proposed' AND assignee_email IS NULL). If this ever answers
  // not_found instead, the guard has drifted from the statement: the write would
  // change zero rows and the caller would get a 404 for a task they just read.
  it("refuses assigning an already-assigned task as wrong_status, never as not_found", () => {
    const result = transitionTask(ctxFor("alice@example.com"), "claimed", {
      action: "assign",
      assigneeEmail: "alice@example.com",
    });

    expect(result).toEqual({ ok: false, code: "wrong_status" });
  });

  it("refuses triage to somebody who holds no write capability", () => {
    process.env.ROLES_ENABLED = "1";

    expect(transitionTask(ctxFor("alice@example.com"), "triage", { action: "accept" })).toEqual({
      ok: false,
      code: "needs_role",
    });
  });

  it("refuses completing a cleared colleague's task", () => {
    const theirs = openTask("theirs", ["bob@example.com"]);

    expect(transitionTask(ctxFor("alice@example.com"), theirs, { action: "complete" })).toEqual({
      ok: false,
      code: "not_assignee",
    });
  });

  // Moving into done is completing by another name. Without this branch the
  // assignee guard on complete is bypassable by dragging a card.
  it("refuses moving a colleague's task into done without triage rights", () => {
    process.env.ROLES_ENABLED = "1";
    const theirs = openTask("theirs", ["bob@example.com"]);

    expect(transitionTask(ctxFor("alice@example.com"), theirs, { action: "move", status: "done" })).toEqual({
      ok: false,
      code: "not_assignee",
    });
  });

  it("keeps delete to the creator, and refuses a cleared colleague", () => {
    const mine = openTask("mine", ["bob@example.com"], "alice@example.com");

    expect(transitionTask(ctxFor("bob@example.com"), mine, { action: "delete" })).toEqual({
      ok: false,
      code: "needs_role",
    });
    expect(transitionTask(ctxFor("alice@example.com"), mine, { action: "delete" })).toEqual({
      ok: true,
      value: { changed: true },
    });
    expect(getVisibleTask(db, mine, "alice@example.com", EXEC)?.status).toBe("dismissed");
  });
});

/**
 * Attendance is a grant in its own right and it is mirrored in three places: the
 * SQL every read composes, the JS guard in canTransition, and the assignee check
 * below. Drop it from one and a meeting attendee reads the task and is then
 * refused the action on it, or is refused as an assignee for work agreed with
 * them in the room. One test per layer, deliberately.
 */
describe("transitionTask, the attendance grant", () => {
  beforeEach(() => {
    insertProposed(db, {
      ...PROPOSED,
      id: "board",
      title: "Board",
      assigneeEmail: null,
      clearance: ["board"],
      sourceAttendees: ["carol@example.com"],
    });
  });

  it("lets an attendee reach a task their groups do not cover, and refuses a non-attendee", () => {
    expect(transitionTask(ctxFor("carol@example.com"), "board", { action: "accept" })).toEqual({
      ok: true,
      value: { changed: true },
    });
    expect(transitionTask(ctxFor("alice@example.com"), "board", { action: "accept" })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("accepts an attendee as an assignee for a group they are not in", () => {
    const result = transitionTask(ctxFor("carol@example.com"), "board", {
      action: "assign",
      assigneeEmail: "carol@example.com",
    });

    expect(result).toEqual({ ok: true, value: { changed: true } });
  });
});

describe("transitionTask, assignee validation", () => {
  it("distinguishes an unknown address from a known but uncleared one", () => {
    expect(
      transitionTask(ctxFor("alice@example.com"), "triage", { action: "assign", assigneeEmail: "stranger@example.com" }),
    ).toEqual({ ok: false, code: "invalid_request", detail: "assignee" });

    expect(
      transitionTask(ctxFor("alice@example.com"), "triage", { action: "assign", assigneeEmail: "carol@example.com" }),
    ).toEqual({ ok: false, code: "invalid_request", detail: "assigneeClearance" });
  });

  // An assigning action naming nobody is a client bug, not an unassign. There is
  // no unassign path through this service, and reporting success for a write
  // that changed nothing would be worse than refusing.
  it("refuses an assigning action that names nobody, and leaves the row alone", () => {
    const result = transitionTask(ctxFor("alice@example.com"), "triage", { action: "assign" });

    expect(result).toEqual({ ok: false, code: "invalid_request", detail: "assignee" });
    expect(getVisibleTask(db, "triage", "alice@example.com", EXEC)?.assigneeEmail).toBeNull();
  });

  it("runs the lifecycle guard before assignee validation, so status wins over a bad list", () => {
    const result = transitionTask(ctxFor("alice@example.com"), "claimed", {
      action: "assign",
      assigneeEmail: "stranger@example.com",
    });

    expect(result).toEqual({ ok: false, code: "wrong_status" });
  });

  // assignee_email must always equal assignees[0]; only assigneeWrite maintains
  // the pair, so every write path has to go through it.
  it("keeps the primary assignee in step with the list on assign and reassign", () => {
    transitionTask(ctxFor("alice@example.com"), "triage", {
      action: "assign",
      assignees: ["bob@example.com", "alice@example.com"],
    });
    const assigned = getVisibleTask(db, "triage", "alice@example.com", EXEC);
    expect(assigned?.assigneeEmail).toBe(assigned?.assignees[0]);
    expect(assigned?.assignees).toEqual(["bob@example.com", "alice@example.com"]);

    const open = openTask("open", ["bob@example.com"]);
    transitionTask(ctxFor("alice@example.com"), open, { action: "reassign", assignees: ["alice@example.com"] });
    const reassigned = getVisibleTask(db, open, "alice@example.com", EXEC);
    expect(reassigned?.assigneeEmail).toBe(reassigned?.assignees[0]);
    expect(reassigned?.assignees).toEqual(["alice@example.com"]);
  });
});

/**
 * LEGAL_FROM in lib/tasks/status-writes.ts is a floor the store enforces
 * independently of canTransition, specifically so no caller can resurrect a
 * dismissed task by naming a status. Asserted directly against the store,
 * because the service's own schema cannot even express the move.
 */
describe("the store's own status floor", () => {
  it("refuses a write back to proposed however authorized the caller is", () => {
    expect(setVisibleStatus(db, "triage", "proposed", "alice@example.com", EXEC)).toBe(false);
    expect(getVisibleTask(db, "triage", "alice@example.com", EXEC)?.status).toBe("proposed");
  });

  it("refuses reopening a dismissed task", () => {
    const gone = openTask("gone", ["alice@example.com"]);
    setStatus(db, gone, "dismissed");

    expect(setVisibleStatus(db, gone, "open", "alice@example.com", EXEC)).toBe(false);
  });
});
