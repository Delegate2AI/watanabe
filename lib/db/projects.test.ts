import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { recordThread } from "./threads";
import { insertProposed } from "./tasks";
import {
  createProject,
  getProjectForRequester,
  listProjectsForRequester,
  updateProject,
  attachThread,
  attachTask,
  listThreads,
  listTasks,
  countThreads,
  countTasks,
  listProjectSummariesForRequester,
} from "./projects";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

function makeProject(db: DatabaseType, overrides: Partial<Parameters<typeof createProject>[1]> = {}) {
  const project = {
    id: "p1",
    name: "Q3 Launch Comms",
    description: "Launch coordination",
    context: "House rule: cite the launch brief.",
    clearance: ["all-hands"],
    ownerEmail: ALICE,
    createdAt: "2026-07-11T12:00:00Z",
    ...overrides,
  };
  createProject(db, project);
  return project;
}

function makeTask(db: DatabaseType, id: string, clearance: string[], assignee: string | null) {
  insertProposed(db, {
    id,
    title: id,
    description: "d",
    assigneeEmail: assignee,
    sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/m1.md",
    clearance,
    due: null,
    origin: "circleback",
    createdAt: "2026-07-11T12:00:00Z",
  });
}

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("projects model, CRUD + visibility", () => {
  it("creates and reads back a project for a cleared requester", () => {
    makeProject(db);
    const got = getProjectForRequester(db, "p1", ALICE, ["all-hands"]);
    expect(got?.name).toBe("Q3 Launch Comms");
    expect(got?.clearance).toEqual(["all-hands"]);
    expect(got?.context).toContain("cite the launch brief");
  });

  it("shows a project when the requester's clearance intersects", () => {
    makeProject(db, { clearance: ["exec"], ownerEmail: BOB });
    expect(getProjectForRequester(db, "p1", ALICE, ["all-hands", "exec"])?.id).toBe("p1");
  });

  it("shows a project to its owner even without a clearance intersect", () => {
    makeProject(db, { clearance: ["exec"] });
    expect(getProjectForRequester(db, "p1", ALICE, ["all-hands"])?.id).toBe("p1");
  });

  it("returns null (no oracle) for a foreign project and an unknown id alike", () => {
    makeProject(db, { clearance: ["exec"], ownerEmail: BOB });
    expect(getProjectForRequester(db, "p1", ALICE, ["all-hands"])).toBeNull();
    expect(getProjectForRequester(db, "does-not-exist", ALICE, ["all-hands"])).toBeNull();
  });

  it("lists only projects the requester is cleared for or owns", () => {
    makeProject(db, { id: "mine", ownerEmail: ALICE, clearance: ["exec"] });
    makeProject(db, { id: "shared", ownerEmail: BOB, clearance: ["all-hands"] });
    makeProject(db, { id: "hidden", ownerEmail: BOB, clearance: ["exec"] });
    const ids = listProjectsForRequester(db, ALICE, ["all-hands"]).map((p) => p.id).sort();
    expect(ids).toEqual(["mine", "shared"]);
  });

  it("updates description/context for the owner only", () => {
    makeProject(db);
    expect(updateProject(db, "p1", BOB, { description: "hijack" })).toBe(false);
    expect(updateProject(db, "p1", ALICE, { description: "new desc", context: "new ctx" })).toBe(true);
    const got = getProjectForRequester(db, "p1", ALICE, ["all-hands"]);
    expect(got?.description).toBe("new desc");
    expect(got?.context).toBe("new ctx");
  });
});

describe("projects model, attach + list guards", () => {
  it("attaches a thread the requester owns and is cleared for the project", () => {
    makeProject(db);
    recordThread(db, "t1", ALICE, "Chat one");
    expect(attachThread(db, "p1", "t1", ALICE, ["all-hands"])).toBe(true);
    expect(listThreads(db, "p1", ALICE, ["all-hands"]).map((t) => t.sdkSessionId)).toEqual(["t1"]);
  });

  it("rejects attaching a thread the requester does not own", () => {
    makeProject(db);
    recordThread(db, "t1", BOB, "Bob's chat");
    expect(attachThread(db, "p1", "t1", ALICE, ["all-hands"])).toBe(false);
    expect(listThreads(db, "p1", ALICE, ["all-hands"])).toEqual([]);
  });

  it("rejects attaching to a project the requester cannot see", () => {
    makeProject(db, { clearance: ["exec"], ownerEmail: BOB });
    recordThread(db, "t1", ALICE, "mine");
    expect(attachThread(db, "p1", "t1", ALICE, ["all-hands"])).toBe(false);
  });

  it("keeps a thread in at most one project (re-attach moves it)", () => {
    makeProject(db, { id: "p1" });
    makeProject(db, { id: "p2" });
    recordThread(db, "t1", ALICE, "chat");
    attachThread(db, "p1", "t1", ALICE, ["all-hands"]);
    attachThread(db, "p2", "t1", ALICE, ["all-hands"]);
    expect(listThreads(db, "p1", ALICE, ["all-hands"])).toEqual([]);
    expect(listThreads(db, "p2", ALICE, ["all-hands"]).map((t) => t.sdkSessionId)).toEqual(["t1"]);
  });

  it("lists only the viewer's own threads within a project (fail closed)", () => {
    makeProject(db);
    recordThread(db, "mine", ALICE, "mine");
    recordThread(db, "bobs", BOB, "bobs");
    attachThread(db, "p1", "mine", ALICE, ["all-hands"]);
    attachThread(db, "p1", "bobs", BOB, ["all-hands"]);
    expect(listThreads(db, "p1", ALICE, ["all-hands"]).map((t) => t.sdkSessionId)).toEqual(["mine"]);
    expect(countThreads(db, "p1", ALICE, ["all-hands"])).toBe(1);
  });

  it("attaches a task visible to the requester whose clearance the project can see", () => {
    makeProject(db, { clearance: ["all-hands"] });
    makeTask(db, "task1", ["all-hands"], ALICE);
    expect(attachTask(db, "p1", "task1", ALICE, ["all-hands"])).toBe(true);
    expect(listTasks(db, "p1", ALICE, ["all-hands"]).map((t) => t.id)).toEqual(["task1"]);
    expect(countTasks(db, "p1", ALICE, ["all-hands"])).toBe(1);
  });

  it("rejects attaching a task the requester cannot see", () => {
    makeProject(db, { clearance: ["exec"] });
    makeTask(db, "task1", ["exec"], BOB);
    expect(attachTask(db, "p1", "task1", ALICE, ["all-hands"])).toBe(false);
  });

  it("rejects attaching a task the project's clearance could not see", () => {
    // Project is all-hands; task is exec-only. Attaching it would surface an
    // exec task to all-hands project members. Rejected.
    makeProject(db, { clearance: ["all-hands"] });
    makeTask(db, "task1", ["exec"], ALICE);
    expect(attachTask(db, "p1", "task1", ALICE, ["all-hands", "exec"])).toBe(false);
  });

  it("lists only tasks visible to the viewer within a project (fail closed)", () => {
    makeProject(db, { clearance: ["all-hands"] });
    makeTask(db, "cleared", ["all-hands"], ALICE);
    makeTask(db, "foreign", ["all-hands"], BOB);
    attachTask(db, "p1", "cleared", ALICE, ["all-hands"]);
    attachTask(db, "p1", "foreign", BOB, ["all-hands"]);
    expect(listTasks(db, "p1", ALICE, ["all-hands"]).map((t) => t.id)).toEqual(["cleared"]);
  });
});

describe("projects summaries", () => {
  it("returns cleared projects with viewer-scoped counts and last activity", () => {
    makeProject(db, { id: "p1", createdAt: "2026-07-01T00:00:00Z" });
    recordThread(db, "t1", ALICE, "chat", "2026-07-05T00:00:00Z");
    attachThread(db, "p1", "t1", ALICE, ["all-hands"]);
    makeTask(db, "task1", ["all-hands"], ALICE);
    attachTask(db, "p1", "task1", ALICE, ["all-hands"]);
    const summaries = listProjectSummariesForRequester(db, ALICE, ["all-hands"]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].threadCount).toBe(1);
    expect(summaries[0].taskCount).toBe(1);
    // The attached task (created 2026-07-11) is newer than the thread update.
    expect(summaries[0].lastActivity).toBe("2026-07-11T12:00:00Z");
  });

  it("bumps last activity for a newly attached task even with no thread activity", () => {
    makeProject(db, { id: "p1", createdAt: "2026-07-01T00:00:00Z" });
    makeTask(db, "task1", ["all-hands"], ALICE);
    // Give the task a newer created_at than the project via a direct stamp.
    db.prepare(`UPDATE tasks SET created_at = @c WHERE id = 'task1'`).run({ c: "2026-07-09T00:00:00Z" });
    attachTask(db, "p1", "task1", ALICE, ["all-hands"]);
    const summaries = listProjectSummariesForRequester(db, ALICE, ["all-hands"]);
    expect(summaries[0].threadCount).toBe(0);
    expect(summaries[0].taskCount).toBe(1);
    expect(summaries[0].lastActivity).toBe("2026-07-09T00:00:00Z");
  });
});

/** Insert a project row directly, bypassing createProject's clearance guard. */
function insertRawProject(db: DatabaseType, id: string, ownerEmail: string, rawClearance: string) {
  db.prepare(`
    INSERT INTO projects (id, name, description, context, clearance, owner_email, created_at)
    VALUES (@id, @name, null, null, @clearance, @owner, @createdAt)
  `).run({ id, name: id, clearance: rawClearance, owner: ownerEmail, createdAt: "2026-07-01T00:00:00Z" });
}

describe("projects: malformed clearance fails closed (finding 1)", () => {
  it("rejects creating a project with an empty or invalid clearance", () => {
    expect(() => makeProject(db, { clearance: [] })).toThrow();
    expect(() => makeProject(db, { clearance: [""] as string[] })).toThrow();
  });

  it("hides a project whose stored clearance is unparseable from a non-owner, but not its owner", () => {
    insertRawProject(db, "corrupt", ALICE, "not json at all");
    expect(getProjectForRequester(db, "corrupt", ALICE, ["all-hands"])?.id).toBe("corrupt");
    expect(getProjectForRequester(db, "corrupt", BOB, ["all-hands", "exec"])).toBeNull();
    expect(listProjectsForRequester(db, BOB, ["all-hands", "exec"]).map((p) => p.id)).toEqual([]);
  });

  it("hides a project whose stored clearance is an empty array from a non-owner", () => {
    insertRawProject(db, "empty", ALICE, "[]");
    expect(getProjectForRequester(db, "empty", ALICE, ["all-hands"])?.id).toBe("empty");
    expect(getProjectForRequester(db, "empty", BOB, ["all-hands"])).toBeNull();
  });
});

describe("projects: child reads are authorized (finding 2, no membership oracle)", () => {
  it("returns identical empty results for a foreign project and an unknown id", () => {
    // Bob owns an exec-only project with a thread and task Alice cannot reach.
    makeProject(db, { id: "bobs", ownerEmail: BOB, clearance: ["exec"] });
    recordThread(db, "bt", BOB, "bobs chat");
    attachThread(db, "bobs", "bt", BOB, ["all-hands", "exec"]);
    makeTask(db, "btask", ["exec"], BOB);
    attachTask(db, "bobs", "btask", BOB, ["all-hands", "exec"]);

    // Alice is only all-hands: a direct call must not distinguish foreign from unknown.
    expect(listThreads(db, "bobs", ALICE, ["all-hands"])).toEqual([]);
    expect(listThreads(db, "unknown", ALICE, ["all-hands"])).toEqual([]);
    expect(countThreads(db, "bobs", ALICE, ["all-hands"])).toBe(0);
    expect(countThreads(db, "unknown", ALICE, ["all-hands"])).toBe(0);
    expect(listTasks(db, "bobs", ALICE, ["all-hands"])).toEqual([]);
    expect(listTasks(db, "unknown", ALICE, ["all-hands"])).toEqual([]);
    expect(countTasks(db, "bobs", ALICE, ["all-hands"])).toBe(0);
    expect(countTasks(db, "unknown", ALICE, ["all-hands"])).toBe(0);
  });
});
