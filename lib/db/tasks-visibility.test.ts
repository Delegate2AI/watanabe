import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { invalidateAliasIndexCache, type AliasIndex } from "@/lib/authority/aliases";
import { resolveClearance } from "@/lib/authority/groups";
import { openDb } from "./client";
import {
  assignTask,
  createManualTask,
  getBoardTasks,
  getForRequester,
  getTaskForRequester,
  insertProposed,
} from "./tasks";
import { requesterKey } from "./tasks-visibility";

// The reported bug: "Mine 0" while "All 3", with every task visibly assigned to
// the viewer. The cause was that writes store a canonical address while reads
// compared the raw session address, so a session authenticated under an alias
// matched the clearance half of visibleWhere and failed the assignee half.

const CANONICAL = "nick@example.com";
const ALIAS = "nick.personal@gmail.test";
const ALIASES: AliasIndex = { [ALIAS]: CANONICAL };
const GROUPS = { "all-hands": [CANONICAL], exec: [CANONICAL] };

// getForRequester resolves aliases through the default index, which reads
// access/aliases.yaml. Pointing MEMORY_CHECKOUT_DIR at a temp registry exercises
// that real wiring rather than injecting past it, which matters here: the bug
// was that production code never consulted this file at all.
const memoryDir = mkdtempSync(path.join(tmpdir(), "aliases-"));
mkdirSync(path.join(memoryDir, "access"), { recursive: true });
writeFileSync(
  path.join(memoryDir, "access", "aliases.yaml"),
  `aliases:\n  ${CANONICAL}:\n    - ${ALIAS}\n`,
);
process.env.MEMORY_CHECKOUT_DIR = memoryDir;

afterAll(() => {
  delete process.env.MEMORY_CHECKOUT_DIR;
  invalidateAliasIndexCache();
  rmSync(memoryDir, { recursive: true, force: true });
});

let db: DatabaseType;

beforeEach(() => {
  invalidateAliasIndexCache();
  db = openDb(":memory:");
  createManualTask(db, {
    title: "Helpcenter",
    description: "Implement new helpcenter, ship it to prod.",
    // Canonical, because every write path resolves or validates to one.
    assignees: [CANONICAL],
    clearance: ["all-hands"],
    due: null,
    createdBy: CANONICAL,
    createdAt: "2026-08-05T12:00:00Z",
  });
});

describe("requesterKey", () => {
  it("resolves an alias to the canonical address the rows were written with", () => {
    expect(requesterKey(ALIAS, ALIASES)).toBe(CANONICAL);
  });

  it("passes a non-alias through normalized, so an empty registry changes nothing", () => {
    expect(requesterKey("  Someone@Example.COM ", {})).toBe("someone@example.com");
    expect(requesterKey(CANONICAL, ALIASES)).toBe(CANONICAL);
  });
});

describe("the Mine/All split", () => {
  it("shows an assigned task under Mine when the session is canonical", () => {
    const mine = getForRequester(db, CANONICAL, ["all-hands"]);
    expect(mine.map((task) => task.title)).toEqual(["Helpcenter"]);
  });

  // The regression itself. Before the fix this returned [], while the All list
  // below still returned the task: exactly the reported "Mine 0, All 3".
  it("shows it under Mine when the session authenticates under an alias", () => {
    const aliasClearance = resolveClearance(ALIAS, GROUPS, ALIASES);
    const mine = getForRequester(db, ALIAS, aliasClearance);
    expect(mine.map((task) => task.title)).toEqual(["Helpcenter"]);
  });

  it("shows the task under All either way, which is why the bug looked partial", () => {
    expect(getBoardTasks(db, ALIAS, ["all-hands"])).toHaveLength(1);
    expect(getBoardTasks(db, CANONICAL, ["all-hands"])).toHaveLength(1);
  });

  it("still hides another person's assigned task from Mine", () => {
    const other = getForRequester(db, "someone.else@example.com", ["all-hands"]);
    expect(other).toEqual([]);
  });
});

// The second reported bug, the mirror of the one above: action items extracted
// from a meeting were visible to a clearance group instead of to the people in
// the meeting. `deriveMeetingVisibility` falls back to ["admins"] when no
// attendee resolves to a group, so the attendees saw nothing and could act on
// nothing, while admins inherited a queue of work they were never part of.
describe("attendance as a visibility grant", () => {
  const ATTENDEE = "dana@example.com";
  const MEETING_TASK = {
    id: "from-the-meeting",
    title: "Fix the background video",
    description: "Shorten it to clear the five minute limit.",
    assigneeEmail: null,
    sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/2026/stream.md",
    clearance: ["admins"],
    sourceAttendees: [ATTENDEE],
    due: null,
    origin: "circleback" as const,
    createdAt: "2026-08-05T12:00:00Z",
  };

  beforeEach(() => {
    insertProposed(db, MEETING_TASK);
  });

  it("shows an attendee the unassigned task from their own meeting", () => {
    const inbound = getForRequester(db, ATTENDEE, ["all-hands"], ["proposed"]);
    expect(inbound.map((task) => task.id)).toEqual(["from-the-meeting"]);
  });

  it("keeps showing it once they accept it, rather than swallowing it on assign", () => {
    // The trap a grant scoped to unassigned rows only would set: visibleWhere is
    // clearance AND (mine OR unassigned), so accepting would fail the clearance
    // half and the task would vanish from the person now responsible for it.
    expect(assignTask(db, "from-the-meeting", [ATTENDEE], ATTENDEE, ["all-hands"])).toBe(true);
    expect(getForRequester(db, ATTENDEE, ["all-hands"], ["proposed"]).map((t) => t.id))
      .toEqual(["from-the-meeting"]);
    expect(getTaskForRequester(db, "from-the-meeting", ATTENDEE, ["all-hands"])).not.toBeNull();
  });

  it("shows it on the board too, so the team page and the list agree", () => {
    expect(getBoardTasks(db, ATTENDEE, ["all-hands"]).map((task) => task.id))
      .toContain("from-the-meeting");
  });

  it("still hides it from someone who neither attended nor holds the clearance", () => {
    expect(getForRequester(db, "stranger@example.com", ["all-hands"], ["proposed"])).toEqual([]);
    expect(getTaskForRequester(db, "from-the-meeting", "stranger@example.com", ["all-hands"])).toBeNull();
    expect(getBoardTasks(db, "stranger@example.com", ["all-hands"]).map((t) => t.id))
      .not.toContain("from-the-meeting");
  });

  it("still shows it to the clearance group, which is not narrowed by the grant", () => {
    expect(getTaskForRequester(db, "from-the-meeting", "admin@example.com", ["all-hands", "admins"]))
      .not.toBeNull();
  });

  it("matches an attendee whose session authenticates under an alias", () => {
    insertProposed(db, { ...MEETING_TASK, id: "aliased", sourceAttendees: [CANONICAL] });
    const found = getTaskForRequester(db, "aliased", ALIAS, ["all-hands"]);
    expect(found?.id).toBe("aliased");
  });

  it("grants nothing when the task records no attendees", () => {
    insertProposed(db, { ...MEETING_TASK, id: "no-attendees", sourceAttendees: [] });
    expect(getTaskForRequester(db, "no-attendees", ATTENDEE, ["all-hands"])).toBeNull();
  });
});

describe("resolveClearance alias handling", () => {
  it("grants an alias session the same groups as the canonical identity", () => {
    expect(resolveClearance(ALIAS, GROUPS, ALIASES)).toEqual(["all-hands", "exec"]);
  });

  it("collapsed to all-hands only before the alias lookup existed", () => {
    // With an empty registry the alias resolves to nothing in groups.yaml, which
    // is the quiet failure the fix removes: still signed in, still sees
    // all-hands, silently loses every group-scoped item.
    expect(resolveClearance(ALIAS, GROUPS, {})).toEqual(["all-hands"]);
  });

  it("never invents a group for someone the registry does not know", () => {
    expect(resolveClearance("stranger@example.com", GROUPS, ALIASES)).toEqual(["all-hands"]);
  });
});
