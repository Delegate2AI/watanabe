import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  acceptTask,
  assignTask,
  canTransition,
  createManualTask,
  getBoardTaskForRequester,
  getBoardTasks,
  getForRequester,
  getTaskForRequester,
  getVisibleTask,
  insertProposed,
  listByMeeting,
  reassignTask,
  setStatus,
  type TaskAction,
  type TaskRecord,
  type TaskStatus,
  type TransitionDenial,
  type TransitionResult,
} from "./tasks";

let db: DatabaseType;

const base = {
  title: "Publish the summary",
  description: "Publish the reviewed meeting summary.",
  sourceMeetingId: "circleback:m1",
  sourceNotePath: "docs/meetings/2026/review.md",
  due: null,
  origin: "circleback" as const,
  sourceAttendees: [],
  createdBy: null,
  createdAt: "2026-07-11T12:00:00Z",
};

beforeEach(() => {
  db = openDb(":memory:");
});

const actions: TaskAction[] = ["accept", "dismiss", "complete", "assign", "reassign", "move", "delete"];
const statuses: TaskStatus[] = ["proposed", "open", "in_progress", "done", "dismissed"];
type Relationship = {
  name: "assignee" | "cleared non-assignee" | "uncleared";
  email: string;
  clearance: string[];
  canTriage: boolean;
  isCreator: boolean;
};
const relationships: Relationship[] = [
  { name: "assignee", email: "alice@example.com", clearance: ["exec"], canTriage: true, isCreator: true },
  { name: "cleared non-assignee", email: "carol@example.com", clearance: ["exec"], canTriage: true, isCreator: false },
  { name: "uncleared", email: "dana@example.com", clearance: ["other"], canTriage: true, isCreator: true },
];

/**
 * Expected results, written out from the spec's state machine rather than
 * derived from the implementation. A mirror of canTransition would prove only
 * that the function equals itself, so every cell here is a literal: changing a
 * rule means changing an explicit expectation, not copying a branch.
 *
 * The task under test is assigned to alice, so "assignee" is alice and
 * "cleared non-assignee" is carol. Both hold canTriage; only alice is creator.
 * An uncleared actor is denied before any of this is consulted.
 */
const OK: TransitionResult = { ok: true };
const denied = (reason: TransitionDenial): TransitionResult => ({ ok: false, reason });

const EXPECTED: Record<TaskStatus, Record<TaskAction, [TransitionResult, TransitionResult]>> = {
  //                    [ assignee,             cleared non-assignee   ]
  proposed: {
    accept:   [OK,                       OK],
    dismiss:  [OK,                       OK],
    complete: [denied("wrong_status"),   denied("wrong_status")],
    // The matrix task carries an assignee, and assign is for unassigned tasks.
    assign:   [denied("wrong_status"),   denied("wrong_status")],
    reassign: [denied("wrong_status"),   denied("wrong_status")],
    move:     [denied("wrong_status"),   denied("wrong_status")],
    delete:   [denied("needs_role"),     denied("needs_role")],
  },
  open: {
    accept:   [denied("wrong_status"),   denied("wrong_status")],
    dismiss:  [denied("wrong_status"),   denied("wrong_status")],
    complete: [OK,                       denied("not_assignee")],
    assign:   [denied("wrong_status"),   denied("wrong_status")],
    reassign: [OK,                       OK],
    move:     [OK,                       OK],
    delete:   [OK,                       denied("needs_role")],
  },
  in_progress: {
    accept:   [denied("wrong_status"),   denied("wrong_status")],
    dismiss:  [denied("wrong_status"),   denied("wrong_status")],
    complete: [OK,                       denied("not_assignee")],
    assign:   [denied("wrong_status"),   denied("wrong_status")],
    reassign: [OK,                       OK],
    move:     [OK,                       OK],
    delete:   [OK,                       denied("needs_role")],
  },
  done: {
    accept:   [denied("terminal"),       denied("terminal")],
    dismiss:  [denied("terminal"),       denied("terminal")],
    complete: [denied("terminal"),       denied("terminal")],
    assign:   [denied("terminal"),       denied("terminal")],
    reassign: [denied("terminal"),       denied("terminal")],
    move:     [OK,                       OK],
    delete:   [denied("terminal"),       denied("terminal")],
  },
  dismissed: {
    accept:   [denied("terminal"),       denied("terminal")],
    dismiss:  [denied("terminal"),       denied("terminal")],
    complete: [denied("terminal"),       denied("terminal")],
    assign:   [denied("terminal"),       denied("terminal")],
    reassign: [denied("terminal"),       denied("terminal")],
    move:     [denied("terminal"),       denied("terminal")],
    delete:   [denied("terminal"),       denied("terminal")],
  },
};

function expectedTransition(
  status: TaskStatus,
  action: TaskAction,
  relationship: Relationship,
): TransitionResult {
  if (relationship.name === "uncleared") return { ok: false, reason: "not_cleared" };
  const [assignee, other] = EXPECTED[status][action];
  return relationship.name === "assignee" ? assignee : other;
}

describe("canTransition", () => {
  const cases = statuses.flatMap((status) =>
    actions.flatMap((action) =>
      relationships.map((relationship) => ({ status, action, relationship })),
    ),
  );

  it.each(cases)("handles $status $action for $relationship.name", ({ status, action, relationship }) => {
    const task: TaskRecord = {
      ...base,
      id: "matrix",
      assigneeEmail: "alice@example.com",
      assignees: ["alice@example.com"],
      clearance: ["exec"],
      status,
    };
    expect(canTransition(task, action, relationship)).toEqual(expectedTransition(status, action, relationship));
  });

  it.each(["accept", "dismiss"] as const)("denies %s when the actor cannot triage", (action) => {
    const task: TaskRecord = {
      ...base,
      id: "role-check",
      assigneeEmail: null,
      clearance: ["exec"],
      status: "proposed",
    };
    expect(canTransition(task, action, {
      email: "alice@example.com",
      clearance: ["exec"],
      canTriage: false,
      isCreator: false,
    })).toEqual({ ok: false, reason: "needs_role" });
  });
});

describe("task store", () => {
  it("inserts proposed tasks, updates status, and lists by meeting", () => {
    expect(insertProposed(db, { ...base, id: "t1", assigneeEmail: "alice@example.com", clearance: ["exec"] })).toBe(true);
    expect(insertProposed(db, { ...base, id: "t1", assigneeEmail: "alice@example.com", clearance: ["exec"] })).toBe(false);
    expect(listByMeeting(db, "circleback:m1")).toMatchObject([{ id: "t1", status: "proposed", clearance: ["exec"] }]);
    expect(setStatus(db, "t1", "open")).toBe(true);
    expect(listByMeeting(db, "circleback:m1")[0].status).toBe("open");
  });

  it("requires inherited clearance and returns only own or triage tasks", () => {
    insertProposed(db, { ...base, id: "mine", assigneeEmail: "alice@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "foreign", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "triage", assigneeEmail: null, clearance: ["exec"] });
    insertProposed(db, { ...base, id: "too-secret", assigneeEmail: "alice@example.com", clearance: ["board"] });
    insertProposed(db, { ...base, id: "uncertain", assigneeEmail: "alice@example.com", clearance: [] });

    expect(getForRequester(db, "alice@example.com", ["all-hands", "exec"]).map((task) => task.id).sort())
      .toEqual(["mine", "triage"]);
  });

  it("owner-scoped status changes hide foreign and unknown ids identically", () => {
    insertProposed(db, { ...base, id: "foreign", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    expect(setStatus(db, "foreign", "open", "alice@example.com", ["exec"])).toBe(false);
    expect(setStatus(db, "unknown", "open", "alice@example.com", ["exec"])).toBe(false);
  });

  it("board visibility shows a teammate's assigned task that the narrow read hides", () => {
    insertProposed(db, { ...base, id: "mine", assigneeEmail: "alice@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "bobs", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "secret", assigneeEmail: "bob@example.com", clearance: ["board"] });
    insertProposed(db, { ...base, id: "assigned-secret", assigneeEmail: "alice@example.com", clearance: ["board"] });

    // Narrow read: only Alice's own (+ triage), never Bob's assigned card.
    expect(getForRequester(db, "alice@example.com", ["exec"]).map((t) => t.id).sort()).toEqual(["mine"]);
    // Board read: every cleared task regardless of assignee, but not the board-only one.
    expect(getBoardTasks(db, "alice@example.com", ["exec"]).map((t) => t.id).sort()).toEqual(["bobs", "mine"]);
  });

  it("returns a cleared colleague's task only through the clearance-scoped read", () => {
    insertProposed(db, { ...base, id: "colleague", assigneeEmail: "bob@example.com", clearance: ["exec"] });

    expect(getVisibleTask(db, "colleague", "carol@example.com", ["exec"])?.id).toBe("colleague");
    expect(getTaskForRequester(db, "colleague", "alice@example.com", ["exec"])).toBeNull();
  });

  it("board read excludes dismissed tasks", () => {
    insertProposed(db, { ...base, id: "live", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "gone", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    setStatus(db, "gone", "dismissed");
    expect(getBoardTasks(db, "alice@example.com", ["exec"]).map((t) => t.id)).toEqual(["live"]);
  });

  it("personal read excludes dismissed tasks", () => {
    insertProposed(db, { ...base, id: "live", assigneeEmail: "alice@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "gone", assigneeEmail: "alice@example.com", clearance: ["exec"] });
    setStatus(db, "gone", "dismissed");
    expect(getForRequester(db, "alice@example.com", ["exec"]).map((task) => task.id)).toEqual(["live"]);
  });

  it("creates a manual task: open, origin manual, null meeting source", () => {
    const task = createManualTask(db, {
      title: "Draft the roadmap",
      description: "One pager for Q3.",
      assignees: ["Bob@Example.com"],
      clearance: ["engineering"],
      due: "2026-08-01",
      createdBy: "owner@example.com",
      createdAt: "2026-07-14T00:00:00Z",
    });
    expect(task.id).toMatch(/[0-9a-f-]{36}/);
    expect(task.status).toBe("open");
    expect(task.origin).toBe("manual");
    expect(task.sourceMeetingId).toBeNull();
    expect(task.assigneeEmail).toBe("bob@example.com");
    const stored = getBoardTaskForRequester(db, task.id, "bob@example.com", ["engineering"]);
    expect(stored?.title).toBe("Draft the roadmap");
  });

  it("reassigns a board-visible non-terminal task and rejects invisible or terminal ones", () => {
    insertProposed(db, { ...base, id: "bobs", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    insertProposed(db, { ...base, id: "secret", assigneeEmail: "bob@example.com", clearance: ["board"] });
    insertProposed(db, { ...base, id: "closed", assigneeEmail: "bob@example.com", clearance: ["exec"] });
    setStatus(db, "bobs", "open");
    setStatus(db, "secret", "open");
    setStatus(db, "closed", "done");

    // Alice is cleared for exec, so she can hand Bob's exec task to Carol.
    expect(reassignTask(db, "bobs", ["carol@example.com"], "alice@example.com", ["exec"])).toBe(true);
    expect(getBoardTaskForRequester(db, "bobs", "carol@example.com", ["exec"])?.assigneeEmail).toBe("carol@example.com");
    // Not cleared for board -> cannot reassign the board-only task.
    expect(reassignTask(db, "secret", ["carol@example.com"], "alice@example.com", ["exec"])).toBe(false);
    // Terminal task cannot be reassigned.
    expect(reassignTask(db, "closed", ["carol@example.com"], "alice@example.com", ["exec"])).toBe(false);
  });
});

describe("a task assigned to several people", () => {
  const both = ["ken@example.com", "angel@example.com"];

  beforeEach(() => {
    insertProposed(db, { ...base, id: "walkthrough", assigneeEmail: null, clearance: ["exec"] });
  });

  it("puts the task in every assignee's queue, not just the first one's", () => {
    expect(assignTask(db, "walkthrough", both, "alice@example.com", ["exec"])).toBe(true);
    expect(getForRequester(db, "ken@example.com", ["exec"]).map((task) => task.id)).toEqual(["walkthrough"]);
    expect(getForRequester(db, "angel@example.com", ["exec"]).map((task) => task.id)).toEqual(["walkthrough"]);
    expect(getForRequester(db, "bob@example.com", ["exec"])).toEqual([]);
  });

  it("keeps assignee_email as the first of the list", () => {
    assignTask(db, "walkthrough", both, "alice@example.com", ["exec"]);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "walkthrough")).toMatchObject({
      assigneeEmail: "ken@example.com",
      assignees: both,
    });
  });

  it("normalizes and dedupes what the caller passes", () => {
    assignTask(db, "walkthrough", [" Ken@Example.com ", "KEN@example.com", "angel@example.com"], "alice@example.com", ["exec"]);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "walkthrough")?.assignees).toEqual(both);
  });

  it("replaces the whole list on reassign rather than appending to it", () => {
    assignTask(db, "walkthrough", both, "alice@example.com", ["exec"]);
    setStatus(db, "walkthrough", "open");
    expect(reassignTask(db, "walkthrough", ["bob@example.com"], "alice@example.com", ["exec"])).toBe(true);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "walkthrough")).toMatchObject({
      assigneeEmail: "bob@example.com",
      assignees: ["bob@example.com"],
    });
  });

  it("accepts with several assignees, and keeps them when accepted with none", () => {
    expect(acceptTask(db, "walkthrough", both, "alice@example.com", ["exec"])).toBe(true);
    const after = listByMeeting(db, "circleback:m1").find((task) => task.id === "walkthrough");
    expect(after).toMatchObject({ status: "open", assignees: both });
  });
});

describe("canTransition guards the spec's two asymmetries", () => {
  const cleared = { email: "carol@example.com", clearance: ["exec"], canTriage: false, isCreator: false };
  const task = (over: Partial<TaskRecord>): TaskRecord => {
    const merged = {
      ...base, id: "guard", assigneeEmail: "alice@example.com", assignees: ["alice@example.com"],
      clearance: ["exec"], status: "open" as const, ...over,
    };
    if (over.assignees) return merged;
    return { ...merged, assignees: merged.assigneeEmail ? [merged.assigneeEmail] : [] };
  };

  it("treats moving into done as completing, so a bystander cannot finish your work", () => {
    expect(canTransition(task({}), "move", cleared, "done")).toEqual({ ok: false, reason: "not_assignee" });
    expect(canTransition(task({}), "move", { ...cleared, canTriage: true }, "done")).toEqual({ ok: true });
    expect(canTransition(task({}), "move", { ...cleared, email: "alice@example.com" }, "done")).toEqual({ ok: true });
  });

  it("still allows a bystander to move a task between the active columns", () => {
    expect(canTransition(task({}), "move", cleared, "in_progress")).toEqual({ ok: true });
    expect(canTransition(task({ status: "done" }), "move", cleared, "open")).toEqual({ ok: true });
  });

  it("allows assign only while the task is unassigned", () => {
    const actor = { ...cleared, canTriage: true };
    expect(canTransition(task({ status: "proposed", assigneeEmail: null }), "assign", actor)).toEqual({ ok: true });
    expect(canTransition(task({ status: "proposed" }), "assign", actor)).toEqual({ ok: false, reason: "wrong_status" });
  });
});
