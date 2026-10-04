import { describe, expect, it } from "vitest";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";
import { groupLabel, inScope, isLive, isProposed, isTeamScope, needsMyTriage } from "./scope";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const merged: TaskRecord = {
    id: "t1",
    title: "Send the revised deck",
    description: "Send the revised deck to reviewers.",
    assigneeEmail: "alice@example.com",
    assignees: [],
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    sourceAttendees: [],
    status: "open",
    due: null,
    origin: "manual",
    projectId: null,
    createdBy: "alice@example.com",
    createdAt: "2026-08-23T12:00:00Z",
    ...overrides,
  };
  // The store keeps `assignee_email` as `assignees[0]`, so a case that names
  // one assignee gets the matching list unless it states one itself.
  if (overrides.assignees) return merged;
  return { ...merged, assignees: merged.assigneeEmail ? [merged.assigneeEmail] : [] };
}

describe("inScope", () => {
  const me = "alice@example.com";

  it("admits everything under team", () => {
    expect(inScope(task({ assigneeEmail: "bob@example.com" }), "team", me)).toBe(true);
    expect(inScope(task({ assigneeEmail: null }), "team", me)).toBe(true);
  });

  it("admits only the actor's own tasks under mine", () => {
    expect(inScope(task(), "mine", me)).toBe(true);
    expect(inScope(task({ assigneeEmail: "bob@example.com" }), "mine", me)).toBe(false);
    expect(inScope(task({ assigneeEmail: null }), "mine", me)).toBe(false);
  });

  it("admits only nobody's tasks under unassigned", () => {
    expect(inScope(task({ assigneeEmail: null }), "unassigned", me)).toBe(true);
    expect(inScope(task(), "unassigned", me)).toBe(false);
  });

  it("matches a group scope against the task's own clearance", () => {
    const scoped = task({ clearance: ["product", "admins"] });
    expect(inScope(scoped, "group:product", me)).toBe(true);
    expect(inScope(scoped, "group:finance", me)).toBe(false);
  });

  // A group narrows Team, so it must not also narrow by assignee.
  it("keeps another person's task inside a group scope", () => {
    const theirs = task({ assigneeEmail: "bob@example.com", clearance: ["product"] });
    expect(inScope(theirs, "group:product", me)).toBe(true);
  });
});

describe("isLive and isProposed", () => {
  const statuses: TaskStatus[] = ["proposed", "open", "in_progress", "done", "dismissed"];

  it("counts open and in_progress as live", () => {
    expect(statuses.filter((status) => isLive(task({ status })))).toEqual(["open", "in_progress"]);
  });

  it("counts only proposed as triage", () => {
    expect(statuses.filter((status) => isProposed(task({ status })))).toEqual(["proposed"]);
  });
});

// Extraction routes a proposal to a named member, so most carry an assignee.
// The strip must match the sidebar badge, which reads `getForRequester`.
describe("needsMyTriage", () => {
  const me = "alice@example.com";

  it("takes an unassigned proposal from a meeting the viewer attended", () => {
    const attended = task({
      status: "proposed",
      assigneeEmail: null,
      sourceAttendees: [me, "bob@example.com"],
    });
    expect(needsMyTriage(attended, me)).toBe(true);
  });

  it("leaves an unassigned proposal from a meeting the viewer missed", () => {
    const missed = task({
      status: "proposed",
      assigneeEmail: null,
      sourceAttendees: ["bob@example.com", "carol@example.com"],
    });
    expect(needsMyTriage(missed, me)).toBe(false);
  });

  it("takes an unassigned proposal whose meeting recorded no attendees", () => {
    const unknownRoom = task({ status: "proposed", assigneeEmail: null, sourceAttendees: [] });
    expect(needsMyTriage(unknownRoom, me)).toBe(true);
  });

  it("takes a proposal routed to the viewer from a meeting they missed", () => {
    const routed = task({
      status: "proposed",
      assigneeEmail: me,
      sourceAttendees: ["bob@example.com"],
    });
    expect(needsMyTriage(routed, me)).toBe(true);
  });

  it("takes a proposal already routed to the viewer", () => {
    expect(needsMyTriage(task({ status: "proposed" }), me)).toBe(true);
  });

  it("leaves a proposal routed to somebody else in their queue", () => {
    expect(needsMyTriage(task({ status: "proposed", assigneeEmail: "bob@example.com" }), me)).toBe(false);
  });

  it("takes nothing that has been accepted", () => {
    expect(needsMyTriage(task({ status: "open", assigneeEmail: null }), me)).toBe(false);
  });
});

describe("isTeamScope", () => {
  it("holds for team and for any group narrowing of it", () => {
    expect(isTeamScope("team")).toBe(true);
    expect(isTeamScope("group:product")).toBe(true);
  });

  it("does not hold for mine or unassigned", () => {
    expect(isTeamScope("mine")).toBe(false);
    expect(isTeamScope("unassigned")).toBe(false);
  });
});

describe("groupLabel", () => {
  it("title-cases each hyphenated part", () => {
    expect(groupLabel("all-hands")).toBe("All Hands");
    expect(groupLabel("admins")).toBe("Admins");
  });
});
