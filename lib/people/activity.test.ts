import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertProposed, setStatus, type TaskStatus } from "@/lib/db/tasks";
import type { Directory } from "./types";

const projection = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => projection.root }));

const loadPeopleMock = vi.hoisted(() => vi.fn<() => Directory>());
vi.mock("./store", () => ({ loadPeople: () => loadPeopleMock() }));

const aliases = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock("@/lib/authority/aliases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authority/aliases")>()),
  aliasIndex: () => aliases,
}));

const { personActivity } = await import("./activity");
type Activity = ReturnType<typeof personActivity>[number];

let db: DatabaseType;
const viewer = "viewer@example.com";
const clearance = ["all-hands"];
// Pinned so every window boundary in this file is arithmetic, not a guess:
// 7d reaches back to 2026-07-29T12:00Z, 30d to 2026-07-06T12:00Z.
const now = "2026-08-05T12:00:00.000Z";

interface TaskOptions {
  assigneeEmail?: string | null;
  status?: TaskStatus;
  due?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  clearance?: string[];
}

function addTask(id: string, options: TaskOptions = {}) {
  insertProposed(db, {
    id,
    title: id,
    description: "Description",
    // Not `??`: a null assignee is the case under test, not a missing option.
    assigneeEmail: options.assigneeEmail === undefined ? "alice@example.com" : options.assigneeEmail,
    sourceMeetingId: `meeting:${id}`,
    sourceNotePath: `docs/meetings/${id}.md`,
    clearance: options.clearance ?? clearance,
    due: options.due ?? null,
    origin: "circleback",
    createdAt: options.createdAt ?? now,
  });
  if (options.status && options.status !== "proposed") {
    // `now` by default so an ordinary done task lands inside every window, the
    // way it did when this count was read off created_at.
    const completedAt = options.completedAt === undefined ? (options.createdAt ?? now) : options.completedAt;
    setStatus(db, id, options.status, undefined, undefined, completedAt ?? undefined);
    if (completedAt === null) db.prepare("UPDATE tasks SET completed_at = NULL WHERE id = ?").run(id);
  }
}

function addMeetingNote(name: string, date: string, attendees = ["alice@example.com"]) {
  const list = attendees.map((attendee) => `  - ${JSON.stringify(attendee)}`).join("\n");
  writeFileSync(
    path.join(projection.root, "meetings", `${name}.md`),
    `---\ntype: meeting\ndate: "${date}"\nattendees:\n${list}\n---\n\n# ${name}\n`,
  );
}

function rowFor(email: string, window: "7d" | "30d" | "all" = "30d"): Activity {
  const row = personActivity(db, viewer, clearance, window).find((item) => item.person.email === email);
  if (!row) throw new Error(`${email} is not on the roster`);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  db = openDb(":memory:");
  projection.root = path.join(tmpdir(), `people-activity-${crypto.randomUUID()}`);
  mkdirSync(path.join(projection.root, "meetings"), { recursive: true });
  loadPeopleMock.mockReset().mockReturnValue({});
  for (const key of Object.keys(aliases)) delete aliases[key];
  process.env.PEOPLE_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(projection.root, { recursive: true, force: true });
  delete process.env.PEOPLE_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
});

describe("personActivity alias folding", () => {
  it("puts a person's task work and meeting work in the same row", () => {
    // The prod screenshot exactly: two rows both named "Nick", one carrying
    // Open 3 / Meetings 0 and the other Open 0 / Meetings 1. Neither row was
    // wrong, they were two halves of one person.
    aliases["nick.personal@example.com"] = "nick@example.com";
    addTask("one", { assigneeEmail: "nick@example.com", status: "open" });
    addTask("two", { assigneeEmail: "nick@example.com", status: "open" });
    addMeetingNote("sync", "2026-08-04T09:00:00.000Z", ["nick.personal@example.com"]);

    const rows = personActivity(db, viewer, clearance, "30d");
    expect(rows.map((row) => row.person.email)).toEqual(["nick@example.com"]);
    expect(rows[0].tasks.open).toBe(2);
    expect(rows[0].meetings.inWindow).toBe(1);
  });

  it("still counts one meeting once when both of a person's addresses attended it", () => {
    aliases["nick.personal@example.com"] = "nick@example.com";
    addMeetingNote("sync", "2026-08-04T09:00:00.000Z", [
      "nick@example.com",
      "nick.personal@example.com",
    ]);

    expect(rowFor("nick@example.com").meetings.inWindow).toBe(1);
  });
});

describe("personActivity task counts", () => {
  it("counts open and in progress together as open work", () => {
    addTask("open", { status: "open" });
    addTask("started", { status: "in_progress" });
    addTask("waiting", { status: "proposed" });

    expect(rowFor("alice@example.com").tasks).toMatchObject({ open: 2, proposed: 1 });
  });

  it("counts a task due before today as overdue, whatever its open status", () => {
    addTask("late-open", { status: "open", due: "2026-08-04" });
    addTask("late-inbox", { status: "proposed", due: "2026-07-01" });
    addTask("due-today", { status: "open", due: "2026-08-05" });
    addTask("future", { status: "open", due: "2026-09-01" });

    expect(rowFor("alice@example.com").tasks.overdue).toBe(2);
  });

  it("does not count a finished task as overdue", () => {
    addTask("late-done", { status: "done", due: "2026-07-01" });

    expect(rowFor("alice@example.com").tasks.overdue).toBe(0);
  });

  it("counts a task with no assignee for nobody", () => {
    addTask("unassigned", { assigneeEmail: null, status: "open", due: "2026-07-01" });
    addTask("mine", { status: "open" });

    const rows = personActivity(db, viewer, clearance, "30d");
    expect(rows).toHaveLength(1);
    expect(rows[0].tasks).toMatchObject({ open: 1, overdue: 0 });
  });

  it("excludes a dismissed task from every count", () => {
    addTask("dropped", { status: "dismissed", due: "2026-07-01" });
    addTask("mine", { status: "open" });

    expect(rowFor("alice@example.com").tasks).toEqual({
      open: 1,
      overdue: 0,
      proposed: 0,
      completed: 0,
    });
  });

  it("lands counts on the assignee rather than on everyone", () => {
    addTask("hers", { assigneeEmail: "alice@example.com", status: "open" });
    addTask("his", { assigneeEmail: "bob@example.com", status: "open", due: "2026-07-01" });

    expect(rowFor("alice@example.com").tasks).toMatchObject({ open: 1, overdue: 0 });
    expect(rowFor("bob@example.com").tasks).toMatchObject({ open: 1, overdue: 1 });
  });
});


describe("personActivity roster and last activity", () => {
  it("takes lastActivityAt as the max across both feeds", () => {
    addTask("mine", { status: "open", createdAt: "2026-08-02T09:00:00.000Z" });
    addMeetingNote("late", "2026-08-04T09:00:00.000Z");
    addMeetingNote("early", "2026-07-01T09:00:00.000Z");

    expect(rowFor("alice@example.com").lastActivityAt).toBe("2026-08-04T09:00:00.000Z");
  });

  it("prefers a task instant when it is the most recent of the two", () => {
    addTask("mine", { status: "open", createdAt: "2026-08-04T18:00:00.000Z" });
    addMeetingNote("earlier", "2026-08-04T09:00:00.000Z");

    expect(rowFor("alice@example.com").lastActivityAt).toBe("2026-08-04T18:00:00.000Z");
  });

  it("has a null lastActivityAt for a person with neither feed", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });

    expect(rowFor("dana@example.com")).toMatchObject({
      lastActivityAt: null,
      meetings: { inWindow: 0, latest: null },
      tasks: { open: 0, overdue: 0, proposed: 0, completed: 0 },
    });
  });

  it("joins the two feeds on the trimmed lower-cased address", () => {
    addTask("mine", { assigneeEmail: " Alice@Example.com ", status: "open" });
    addMeetingNote("sync", "2026-08-04T09:00:00.000Z", ["ALICE@example.com  "]);

    const rows = personActivity(db, viewer, clearance, "30d");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      person: { email: "alice@example.com" },
      tasks: { open: 1 },
      meetings: { inWindow: 1 },
    });
  });

  it("covers every roster person, including one with nothing to show", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });
    addTask("mine", { status: "open" });

    expect(personActivity(db, viewer, clearance, "30d").map((row) => row.person.email))
      .toEqual(["alice@example.com", "dana@example.com"]);
  });

  it("returns all-zero rows rather than throwing when both feeds are disabled", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });
    addTask("mine", { status: "open", due: "2026-07-01" });
    addMeetingNote("sync", "2026-08-04T09:00:00.000Z");
    delete process.env.TASKS_ENABLED;
    delete process.env.MEETINGS_ENABLED;

    expect(personActivity(db, viewer, clearance, "30d")).toEqual([{
      person: { email: "dana@example.com", name: "Dana Reed", initials: "DR", isSelf: false },
      tasks: { open: 0, overdue: 0, proposed: 0, completed: 0 },
      meetings: { inWindow: 0, latest: null },
      lastActivityAt: null,
    }]);
  });
});
