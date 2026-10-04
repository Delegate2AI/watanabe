import { describe, expect, it, vi } from "vitest";
import type { TaskRecord, TaskStatus } from "@/lib/db/tasks";

// The alias registry is a real file on the private access ref; stubbing the
// index keeps these tests off the filesystem while exercising the same seam
// tasks, meetings and clearance resolution already go through.
const aliases = vi.hoisted(() => ({ "a.personal@gmail.com": "alice@example.com" }) as Record<string, string>);
vi.mock("@/lib/authority/aliases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authority/aliases")>()),
  aliasIndex: () => aliases,
}));

const { canTransition } = await import("./lifecycle");

function task(status: TaskStatus): TaskRecord {
  return {
    id: "t1",
    title: "Send the revised deck",
    description: "Send it to the reviewers.",
    assigneeEmail: "alice@example.com",
    assignees: ["alice@example.com"],
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    sourceAttendees: [],
    status,
    due: null,
    origin: "manual",
    projectId: null,
    createdBy: "alice@example.com",
    createdAt: "2026-08-23T12:00:00Z",
  };
}

const underAlias = {
  email: "a.personal@gmail.com",
  clearance: ["all-hands"],
  canTriage: false,
  isCreator: false,
};

/**
 * Assignees are stored canonical and every read path canonicalizes the
 * requester. The guard compared the raw session address instead, so a session
 * authenticated under a registered alias was refused its own task, and the
 * reason given was `not_assignee` when the person plainly was the assignee.
 */
describe("canTransition under an alias identity", () => {
  it("lets the assignee complete an open task", () => {
    expect(canTransition(task("open"), "complete", underAlias)).toEqual({ ok: true });
  });

  it("lets the assignee complete an in progress task", () => {
    expect(canTransition(task("in_progress"), "complete", underAlias)).toEqual({ ok: true });
  });

  it("lets the assignee drag it into done", () => {
    expect(canTransition(task("in_progress"), "move", underAlias, "done")).toEqual({ ok: true });
  });

  it("still refuses somebody else's task", () => {
    const theirs = { ...task("open"), assigneeEmail: "bob@example.com", assignees: ["bob@example.com"] };
    expect(canTransition(theirs, "complete", underAlias)).toEqual({ ok: false, reason: "not_assignee" });
  });

  // isKnownMember validates an assignee canonically but the write paths store
  // the address as submitted, so a row can hold the alias rather than the
  // canonical form. Both directions have to match.
  it("matches a canonical session against an assignee stored as an alias", () => {
    const stored = { ...task("in_progress"), assigneeEmail: "a.personal@gmail.com", assignees: ["a.personal@gmail.com"] };
    const canonical = { ...underAlias, email: "alice@example.com" };
    expect(canTransition(stored, "complete", canonical)).toEqual({ ok: true });
    expect(canTransition(stored, "move", canonical, "done")).toEqual({ ok: true });
  });

  it("matches an alias session against an assignee stored as the same alias", () => {
    const stored = { ...task("open"), assigneeEmail: "a.personal@gmail.com", assignees: ["a.personal@gmail.com"] };
    expect(canTransition(stored, "complete", underAlias)).toEqual({ ok: true });
  });

  it("refuses an unassigned task rather than matching an empty address", () => {
    const orphan = { ...task("in_progress"), assigneeEmail: null, assignees: [] };
    expect(canTransition(orphan, "complete", underAlias)).toEqual({ ok: false, reason: "not_assignee" });
  });

  // A status that cannot complete is a status problem, not an identity one.
  it("names the status when the status is what is wrong", () => {
    expect(canTransition(task("proposed"), "complete", underAlias)).toEqual({ ok: false, reason: "wrong_status" });
  });
});
