import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertProposed, setStatus } from "@/lib/db/tasks";

// Same seam the activity aggregator's tests use: the meetings reader resolves
// its root through `vaultRootFor`, so a tmpdir of markdown files IS the
// clearance-scoped projection as far as this module can tell.
const projection = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => projection.root }));

const { personDetail } = await import("./detail");

let db: DatabaseType;
const KEN = "ken@example.com";
const createdAt = "2026-08-01T12:00:00.000Z";

function addTask(id: string, assigneeEmail: string | null, due: string | null) {
  insertProposed(db, {
    id,
    title: id,
    description: "Description",
    assigneeEmail,
    sourceMeetingId: null,
    sourceNotePath: null,
    clearance: ["all-hands"],
    due,
    origin: "manual",
    createdAt,
  });
}

function addMeeting(name: string, date: string, attendees: string[]) {
  const frontmatter = [
    "---",
    "type: meeting",
    `date: ${date}`,
    "visibility: [all-hands]",
    "attendees:",
    ...attendees.map((email) => `  - ${email}`),
    "---",
    `# ${name}`,
    "",
  ].join("\n");
  writeFileSync(path.join(projection.root, "meetings", `${name}.md`), frontmatter);
}

beforeEach(() => {
  db = openDb(":memory:");
  projection.root = path.join(tmpdir(), `people-detail-${crypto.randomUUID()}`);
  mkdirSync(path.join(projection.root, "meetings"), { recursive: true });
  process.env.TASKS_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
  process.env.PEOPLE_ENABLED = "1";
});

afterEach(() => {
  db.close();
  rmSync(projection.root, { recursive: true, force: true });
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
  delete process.env.PEOPLE_ENABLED;
});

describe("personDetail", () => {
  it("returns null for someone outside the roster this viewer can see", () => {
    expect(personDetail(db, "drew@example.com", ["all-hands"], "stranger@example.com")).toBeNull();
  });

  it("returns null for a blank address rather than matching everyone", () => {
    addTask("t1", KEN, null);
    expect(personDetail(db, "drew@example.com", ["all-hands"], "   ")).toBeNull();
  });

  it("matches the person regardless of address case", () => {
    addTask("t1", KEN, null);
    const detail = personDetail(db, "drew@example.com", ["all-hands"], "KEN@example.com");
    expect(detail?.person.email).toBe(KEN);
  });

  it("groups tasks by state and lists an overdue task only once", () => {
    addTask("late", KEN, "2020-01-01");
    setStatus(db, "late", "in_progress");
    addTask("soon", KEN, "2099-01-01");
    setStatus(db, "soon", "open");
    addTask("inbox", KEN, null);
    addTask("someone-else", "elliot@example.com", "2020-01-01");

    const detail = personDetail(db, "drew@example.com", ["all-hands"], KEN);
    expect(detail?.tasks.overdue.map((task) => task.id)).toEqual(["late"]);
    // The overdue row is in progress, but it must not also appear under In
    // progress: one task, one group.
    expect(detail?.tasks.inProgress).toEqual([]);
    expect(detail?.tasks.open.map((task) => task.id)).toEqual(["soon"]);
    expect(detail?.tasks.proposed.map((task) => task.id)).toEqual(["inbox"]);
  });

  it("lists only the meetings the person attended", () => {
    addTask("t1", KEN, null);
    addMeeting("standup", "2026-08-03", [KEN, "elliot@example.com"]);
    addMeeting("private-sync", "2026-08-02", ["elliot@example.com"]);

    const detail = personDetail(db, "drew@example.com", ["all-hands"], KEN);
    expect(detail?.meetings.map((meeting) => meeting.title)).toEqual(["standup"]);
  });

  it("contributes no tasks when the tasks subsystem is off", () => {
    addTask("t1", KEN, null);
    addMeeting("standup", "2026-08-03", [KEN]);
    delete process.env.TASKS_ENABLED;

    const detail = personDetail(db, "drew@example.com", ["all-hands"], KEN);
    expect(detail?.tasks.overdue).toEqual([]);
    expect(detail?.tasks.open).toEqual([]);
    expect(detail?.meetings).toHaveLength(1);
  });

  it("withholds group membership from a viewer who does not administer access", () => {
    addTask("t1", KEN, null);
    // Group membership is admin-only everywhere else in the app, so a profile
    // page must not be the one place it leaks to an ordinary colleague.
    const detail = personDetail(db, "elliot@example.com", ["all-hands"], KEN);
    expect(detail?.groups).toEqual([]);
  });

  it("contributes no meetings when the meetings subsystem is off", () => {
    addTask("t1", KEN, null);
    addMeeting("standup", "2026-08-03", [KEN]);
    delete process.env.MEETINGS_ENABLED;

    const detail = personDetail(db, "drew@example.com", ["all-hands"], KEN);
    expect(detail?.meetings).toEqual([]);
  });
});
