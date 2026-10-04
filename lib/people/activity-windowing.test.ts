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

describe("personActivity windowing", () => {
  it("keeps every task count outside the window", () => {
    addTask("old-open", { status: "open", due: "2026-01-01", createdAt: "2026-01-01T09:00:00.000Z" });
    addTask("old-done", { status: "done", createdAt: "2026-01-01T09:00:00.000Z" });
    addTask("recent-done", { status: "done", createdAt: "2026-08-04T09:00:00.000Z" });

    const counts = { open: 1, overdue: 1, proposed: 0, completed: 2 };
    expect(rowFor("alice@example.com", "7d").tasks).toEqual(counts);
    expect(rowFor("alice@example.com", "30d").tasks).toEqual(counts);
    expect(rowFor("alice@example.com", "all").tasks).toEqual(counts);
  });

  // `completed_at` exists only from 2026-08-21, so every task finished before
  // that carries no stamp. Windowing on it read Completed 0 beside a person
  // page listing seventeen finished tasks.
  it("counts a done task with no completion time in every window", () => {
    addTask("finished-before-the-column-existed", {
      status: "done",
      createdAt: "2026-01-01T09:00:00.000Z",
      completedAt: null,
    });

    expect(rowFor("alice@example.com", "7d").tasks).toMatchObject({ completed: 1 });
    expect(rowFor("alice@example.com", "30d").tasks).toMatchObject({ completed: 1 });
    expect(rowFor("alice@example.com", "all").tasks).toMatchObject({ completed: 1 });
  });

  it("counts one meeting once when an attendee is listed more than once", () => {
    // Frontmatter comes from a calendar invite, so the same person can arrive
    // as two spellings. Counting each entry would credit one meeting twice and
    // contradict the person page, which lists it once.
    addMeetingNote("sync", "2026-08-05T09:00:00.000Z", [
      "alice@example.com",
      "Alice@Example.com",
      " alice@example.com ",
    ]);
    expect(rowFor("alice@example.com").meetings.inWindow).toBe(1);
  });

  it("counts only the meetings inside the window", () => {
    addMeetingNote("today", "2026-08-05T09:00:00.000Z");
    addMeetingNote("last-week", "2026-07-31T09:00:00.000Z");
    addMeetingNote("last-month", "2026-07-10T09:00:00.000Z");
    addMeetingNote("last-year", "2025-08-05T09:00:00.000Z");

    expect(rowFor("alice@example.com", "7d").meetings.inWindow).toBe(2);
    expect(rowFor("alice@example.com", "30d").meetings.inWindow).toBe(3);
    expect(rowFor("alice@example.com", "all").meetings.inWindow).toBe(4);
  });

  it("reports the latest meeting even when the window holds none", () => {
    addMeetingNote("old", "2026-01-04T09:00:00.000Z");
    addMeetingNote("older", "2025-01-04T09:00:00.000Z");

    const row = rowFor("alice@example.com", "7d");
    expect(row.meetings.inWindow).toBe(0);
    expect(row.meetings.latest).toEqual({
      title: "old",
      date: "2026-01-04T09:00:00.000Z",
      href: "/kb/meetings/old",
    });
  });

  // Otherwise a row reads "Completed 1" beside "Last activity: 7 months ago",
  // which is a contradiction on one line.
  it("treats finishing a task as activity, not only creating one", () => {
    addTask("old-but-finished-recently", {
      status: "done",
      createdAt: "2026-01-01T09:00:00.000Z",
      completedAt: "2026-08-04T09:00:00.000Z",
    });

    expect(rowFor("alice@example.com", "7d").lastActivityAt).toBe("2026-08-04T09:00:00.000Z");
  });
});
