import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { insertProposed } from "@/lib/db/tasks";
import type { Directory } from "./types";

const projection = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => projection.root }));

const loadPeopleMock = vi.hoisted(() => vi.fn<() => Directory>());
vi.mock("./store", () => ({ loadPeople: () => loadPeopleMock() }));

// The alias registry is a real file on the private access ref; stubbing the
// index keeps these tests off the filesystem while exercising the same seam
// tasks, meetings and clearance resolution already go through.
const aliases = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock("@/lib/authority/aliases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authority/aliases")>()),
  aliasIndex: () => aliases,
}));

const { buildRoster } = await import("./roster");

let db: DatabaseType;
const viewer = "viewer@example.com";
const createdAt = "2026-08-01T13:00:00.000Z";

function addTask(id: string, assigneeEmail: string | null, clearance: string[] = ["all-hands"]) {
  insertProposed(db, {
    id,
    title: id,
    description: "Description",
    assigneeEmail,
    sourceMeetingId: `meeting:${id}`,
    sourceNotePath: `docs/meetings/${id}.md`,
    clearance,
    due: null,
    origin: "circleback",
    createdAt,
  });
}

function addMeetingNote(name: string, attendees: string[], date = "2026-08-01T10:00:00.000Z") {
  const list = attendees.map((attendee) => `  - ${JSON.stringify(attendee)}`).join("\n");
  writeFileSync(
    path.join(projection.root, "meetings", `${name}.md`),
    `---\ntype: meeting\ndate: "${date}"\nattendees:\n${list}\n---\n\n# ${name}\n`,
  );
}

function emailsOf(clearance: string[] = ["all-hands"]): string[] {
  return buildRoster(db, viewer, clearance).map((person) => person.email);
}

beforeEach(() => {
  db = openDb(":memory:");
  projection.root = path.join(tmpdir(), `people-roster-${crypto.randomUUID()}`);
  mkdirSync(path.join(projection.root, "meetings"), { recursive: true });
  loadPeopleMock.mockReset().mockReturnValue({});
  for (const key of Object.keys(aliases)) delete aliases[key];
  process.env.PEOPLE_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
});

afterEach(() => {
  db.close();
  rmSync(projection.root, { recursive: true, force: true });
  delete process.env.PEOPLE_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.MEETINGS_ENABLED;
});

describe("buildRoster", () => {
  it("unions the directory, task assignees and meeting attendees", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });
    addTask("one", "bob@example.com");
    addMeetingNote("sync", ["carol@example.com"]);

    expect(emailsOf()).toEqual([
      "bob@example.com",
      "carol@example.com",
      "dana@example.com",
    ]);
  });

  it("counts a person appearing in all three sources once", () => {
    loadPeopleMock.mockReturnValue({ "alice@example.com": { name: "Alice Ng", source: "idp" } });
    addTask("one", "alice@example.com");
    addTask("two", "alice@example.com");
    addMeetingNote("sync", ["alice@example.com"]);
    addMeetingNote("standup", ["alice@example.com"]);

    expect(emailsOf()).toEqual(["alice@example.com"]);
  });

  it("normalizes case and surrounding whitespace before deduping", () => {
    loadPeopleMock.mockReturnValue({ "Alice@Example.com ": { name: "Alice Ng", source: "idp" } });
    addMeetingNote("sync", ["  ALICE@example.com  ", "alice@EXAMPLE.com"]);

    expect(emailsOf()).toEqual(["alice@example.com"]);
  });

  it("keeps a directory person who has no tasks and no meetings", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });

    expect(emailsOf()).toEqual(["dana@example.com"]);
  });

  it("leaves out a person whose only work is outside the viewer clearance", () => {
    addTask("visible", "bob@example.com", ["all-hands"]);
    addTask("restricted", "eve@example.com", ["board"]);

    expect(emailsOf(["all-hands"])).toEqual(["bob@example.com"]);
  });

  it("skips a task nobody is assigned to and an empty attendee entry", () => {
    addTask("unassigned", null);
    addMeetingNote("sync", ["   ", "carol@example.com"]);

    expect(emailsOf()).toEqual(["carol@example.com"]);
  });

  it("sorts by display name rather than by email", () => {
    loadPeopleMock.mockReturnValue({
      "zoe@example.com": { name: "Aaron Pike", source: "manual" },
      "aaron@example.com": { name: "Zoe Quist", source: "manual" },
    });

    expect(buildRoster(db, viewer, ["all-hands"]).map((person) => person.name))
      .toEqual(["Aaron Pike", "Zoe Quist"]);
  });

  it("marks the viewer as self", () => {
    addTask("mine", viewer);

    expect(buildRoster(db, " VIEWER@example.com ", ["all-hands"])[0]).toMatchObject({
      email: viewer,
      isSelf: true,
    });
  });

  it("does not read the directory at all when PEOPLE_ENABLED is off", () => {
    loadPeopleMock.mockReturnValue({ "dana@example.com": { name: "Dana Reed", source: "idp" } });
    addTask("one", "bob@example.com");
    delete process.env.PEOPLE_ENABLED;

    // The flag promises no access/people.yaml is read, so the directory-only
    // person is absent, while anyone with real work still appears.
    expect(emailsOf()).toEqual(["bob@example.com"]);
    expect(loadPeopleMock).not.toHaveBeenCalled();
  });

  it("reads the directory once for the whole union", () => {
    addTask("one", "bob@example.com");
    addMeetingNote("sync", ["carol@example.com"]);

    buildRoster(db, viewer, ["all-hands"]);

    expect(loadPeopleMock).toHaveBeenCalledTimes(1);
  });

  it("contributes no task emails when tasks are disabled", () => {
    delete process.env.TASKS_ENABLED;
    addTask("one", "bob@example.com");
    addMeetingNote("sync", ["carol@example.com"]);

    expect(emailsOf()).toEqual(["carol@example.com"]);
  });

  it("contributes no meeting emails when meetings are disabled", () => {
    delete process.env.MEETINGS_ENABLED;
    addTask("one", "bob@example.com");
    addMeetingNote("sync", ["carol@example.com"]);

    expect(emailsOf()).toEqual(["bob@example.com"]);
  });

  it("is empty rather than throwing when the directory read blows up", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadPeopleMock.mockImplementation(() => {
      throw new Error("unreadable");
    });
    addTask("one", "bob@example.com");

    expect(buildRoster(db, viewer, ["all-hands"])).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("still lists task and meeting people when the meeting vault is missing", () => {
    rmSync(projection.root, { recursive: true, force: true });
    addTask("one", "bob@example.com");

    expect(emailsOf()).toEqual(["bob@example.com"]);
  });

  it("folds a person's alias addresses into one row", () => {
    // The prod symptom: one human appeared twice, once from the address their
    // tasks are assigned to and once from the address the calendar invite
    // carried. `access/aliases.yaml` already answers this for tasks, meetings
    // and clearance; the roster was simply not asking.
    aliases["nick.personal@example.com"] = "nick@example.com";
    addTask("one", "nick@example.com");
    addMeetingNote("sync", ["nick.personal@example.com"]);

    expect(emailsOf()).toEqual(["nick@example.com"]);
  });

  it("folds an alias that arrives only from the directory", () => {
    aliases["nick.personal@example.com"] = "nick@example.com";
    loadPeopleMock.mockReturnValue({
      "nick@example.com": { name: "Nick", source: "idp" },
      "nick.personal@example.com": { name: "Nick", source: "idp" },
    });

    expect(emailsOf()).toEqual(["nick@example.com"]);
  });
});
