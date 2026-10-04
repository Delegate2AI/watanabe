import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
const isRolesEnabledMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
  isRolesEnabled: () => isRolesEnabledMock(),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return {
    ...actual,
    loadGroups: () => ({
      exec: ["alice@example.com", "bob@example.com", "carol@example.com"],
      // Dana is a known member of the org but holds no exec clearance, which is
      // what makes her a valid assignee by isKnownMember and an invalid one
      // for an exec task.
      research: ["dana@example.com"],
    }),
  };
});
let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createManualTask, getVisibleTask, insertProposed, listByMeeting } = await import("@/lib/db/tasks");
const ALICE = { email: "alice@example.com" };
const BOB = { email: "bob@example.com" };
const DANA = { email: "dana@example.com" };

function request(id: string, body: unknown): Request {
  return new Request(`http://t/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function context(id: string) { return { params: Promise.resolve({ id }) }; }

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(false);
  isRolesEnabledMock.mockReset().mockReturnValue(false);
  const common = {
    description: "Description", sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/m1.md", clearance: ["exec"], due: null,
    origin: "circleback" as const, createdAt: "2026-07-11T12:00:00Z",
  };
  insertProposed(db, { ...common, id: "mine", title: "Mine", assigneeEmail: ALICE.email });
  insertProposed(db, { ...common, id: "foreign", title: "Foreign", assigneeEmail: BOB.email });
  insertProposed(db, { ...common, id: "triage", title: "Triage", assigneeEmail: null });
  insertProposed(db, { ...common, id: "secret", title: "Secret", assigneeEmail: null, clearance: ["board"] });
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
});

describe("PATCH /api/tasks/[id]", () => {
  it("accepts then completes an owned task", async () => {
    expect((await PATCH(request("mine", { action: "accept" }), context("mine"))).status).toBe(200);
    expect((await PATCH(request("mine", { action: "complete" }), context("mine"))).status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "mine")?.status).toBe("done");
  });

  it("accepts an unassigned proposal without assigning it", async () => {
    const response = await PATCH(request("triage", { action: "accept" }), context("triage"));
    expect(response.status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")).toMatchObject({
      status: "open",
      assigneeEmail: null,
    });
  });

  it("accepts an unassigned proposal with a known assignee", async () => {
    const response = await PATCH(
      request("triage", { action: "accept", assignee: BOB.email }),
      context("triage"),
    );
    expect(response.status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")).toMatchObject({
      status: "open",
      assigneeEmail: BOB.email,
    });
  });

  it("dismisses an unassigned proposal", async () => {
    expect((await PATCH(request("triage", { action: "dismiss" }), context("triage"))).status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")?.status).toBe("dismissed");
  });

  it("denies triage without the required role using a reason code", async () => {
    isRolesEnabledMock.mockReturnValue(true);
    const response = await PATCH(request("triage", { action: "dismiss" }), context("triage"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("assigns a cleared triage task to a portal member", async () => {
    expect((await PATCH(request("triage", { action: "assign", assigneeEmail: BOB.email }), context("triage"))).status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")?.assigneeEmail).toBe(BOB.email);
  });

  it("assigns a triage task to several members at once", async () => {
    const response = await PATCH(
      request("triage", { action: "assign", assignees: [BOB.email, "carol@example.com"] }),
      context("triage"),
    );
    expect(response.status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")).toMatchObject({
      assigneeEmail: BOB.email,
      assignees: [BOB.email, "carol@example.com"],
    });
  });

  // One unknown address must not slip through on the back of a known one.
  it("rejects a list where any member is unknown", async () => {
    const response = await PATCH(
      request("triage", { action: "assign", assignees: [BOB.email, "stranger@example.com"] }),
      context("triage"),
    );
    expect(response.status).toBe(400);
    expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "triage")?.assignees).toEqual([]);
  });

  it("rejects an assigning action that names nobody", async () => {
    const response = await PATCH(request("triage", { action: "assign", assignees: [] }), context("triage"));
    expect(response.status).toBe(400);
  });

  it("returns the same 404 for uncleared and unknown ids", async () => {
    const foreign = await PATCH(request("secret", { action: "accept" }), context("secret"));
    const unknown = await PATCH(request("unknown", { action: "accept" }), context("unknown"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await foreign.text()).toBe(await unknown.text());
  });

  it("reassigns a cleared teammate's active task to another known member", async () => {
    // Alice is cleared for exec, so she can hand Bob's task to Carol.
    await PATCH(request("foreign", { action: "accept" }), context("foreign"));
    const response = await PATCH(
      request("foreign", { action: "reassign", assigneeEmail: "carol@example.com" }),
      context("foreign"),
    );
    expect(response.status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((t) => t.id === "foreign")?.assigneeEmail).toBe("carol@example.com");
  });

  it("rejects reassigning to an unknown member", async () => {
    await PATCH(request("foreign", { action: "accept" }), context("foreign"));
    const response = await PATCH(
      request("foreign", { action: "reassign", assigneeEmail: "stranger@example.com" }),
      context("foreign"),
    );
    expect(response.status).toBe(400);
  });

  it("moves an owned task through in_progress to done", async () => {
    await PATCH(request("mine", { action: "accept" }), context("mine")); // proposed -> open
    expect((await PATCH(request("mine", { action: "move", status: "in_progress" }), context("mine"))).status).toBe(200);
    expect((await PATCH(request("mine", { action: "move", status: "done" }), context("mine"))).status).toBe(200);
    expect(listByMeeting(db, "circleback:m1").find((t) => t.id === "mine")?.status).toBe("done");
  });

  it("allows a cleared non-assignee to move an active task", async () => {
    // A cleared teammate may move a task. Only completion is assignee-scoped.
    await PATCH(request("foreign", { action: "accept" }), context("foreign"));
    const response = await PATCH(request("foreign", { action: "move", status: "in_progress" }), context("foreign"));
    expect(response.status).toBe(200);
  });

  it("rejects completion by a non-assignee with a reason code", async () => {
    await PATCH(request("foreign", { action: "accept" }), context("foreign"));
    const response = await PATCH(request("foreign", { action: "complete" }), context("foreign"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "not_assignee" } });
  });

  it("keeps a task visible to the assigner after assigning a colleague", async () => {
    expect((await PATCH(
      request("triage", { action: "assign", assigneeEmail: BOB.email }),
      context("triage"),
    )).status).toBe(200);

    const response = await GET(new Request("http://t/api/tasks/triage"), context("triage"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ task: { id: "triage", assigneeEmail: BOB.email } });
  });

  it("deletes a manual task for its creator", async () => {
    const task = createManualTask(db, {
      title: "Creator task",
      description: "Description",
      assignees: [ALICE.email],
      clearance: ["exec"],
      due: null,
      createdBy: ALICE.email,
      createdAt: "2026-07-11T12:00:00Z",
    });
    const response = await PATCH(request(task.id, { action: "delete" }), context(task.id));
    expect(response.status).toBe(200);
    expect(getVisibleTask(db, task.id, "alice@example.com", ["exec"])?.status).toBe("dismissed");
  });

  it("refuses an assignee who is not cleared for the task", async () => {
    insertProposed(db, {
      id: "restricted", title: "Exec only", description: "Body", assigneeEmail: null,
      sourceMeetingId: null, sourceNotePath: null, clearance: ["exec"], due: null,
      origin: "circleback", createdAt: "2026-07-11T12:00:00Z",
    });
    const response = await PATCH(
      request("restricted", { action: "accept", assignee: DANA.email }),
      context("restricted"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", detail: "assigneeClearance" },
    });
    expect(getVisibleTask(db, "restricted", "alice@example.com", ["exec"])?.status).toBe("proposed");
  });

  // Dana holds research, never exec, so every clearance check refuses her. What
  // she has is attendance: this task came out of a meeting she sat in, and
  // before the grant existed she could not see it, accept it, or be given it.
  describe("a meeting attendee the task's clearance does not cover", () => {
    beforeEach(() => {
      insertProposed(db, {
        id: "attended",
        title: "Fix the background video",
        description: "Shorten it to clear the five minute limit.",
        assigneeEmail: null,
        sourceMeetingId: "circleback:m1",
        sourceNotePath: "docs/meetings/m1.md",
        clearance: ["exec"],
        sourceAttendees: [DANA.email],
        due: null,
        origin: "circleback",
        createdAt: "2026-07-11T12:00:00Z",
      });
      requireIdentityMock.mockResolvedValue({ identity: DANA });
    });

    it("reads the task", async () => {
      const response = await GET(new Request("http://t/api/tasks/attended"), context("attended"));
      expect(response.status).toBe(200);
      expect((await response.json()).task.id).toBe("attended");
    });

    it("accepts it and takes it, which is the whole point of the grant", async () => {
      const response = await PATCH(
        request("attended", { action: "accept", assignee: DANA.email }),
        context("attended"),
      );
      expect(response.status).toBe(200);
      expect(listByMeeting(db, "circleback:m1").find((task) => task.id === "attended"))
        .toMatchObject({ status: "open", assigneeEmail: DANA.email });
    });

    it("stays readable to her after she accepts it", async () => {
      await PATCH(request("attended", { action: "accept", assignee: DANA.email }), context("attended"));
      const response = await GET(new Request("http://t/api/tasks/attended"), context("attended"));
      expect(response.status).toBe(200);
    });

    it("gets the same 404 as anyone else on a task from a meeting she missed", async () => {
      const response = await GET(new Request("http://t/api/tasks/triage"), context("triage"));
      expect(response.status).toBe(404);
    });
  });

  it("rejects deletion by the assignee when someone else created the task", async () => {
    const task = createManualTask(db, {
      title: "Creator task",
      description: "Description",
      assignees: [BOB.email],
      clearance: ["exec"],
      due: null,
      createdBy: ALICE.email,
      createdAt: "2026-07-11T12:00:00Z",
    });
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const response = await PATCH(request(task.id, { action: "delete" }), context(task.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });
});
