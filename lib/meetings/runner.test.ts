import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "@/lib/db/client";
import { getIngestedMeeting, getMeetingJob, insertMeetingJob, upsertIngestedMeeting } from "@/lib/db/meetings";
import type { Meeting } from "./circleback";
import { runMeetingJob } from "./runner";
import { getConfig } from "@/lib/config";

const baseMeeting: Meeting = {
  id: "m1",
  title: "Weekly Review",
  startAt: "2026-07-11T10:00:00Z",
  endAt: "2026-07-11T10:30:00Z",
  attendees: [{ email: "alice@example.com" }],
  tags: [],
  actionItems: [],
  transcript: { meetingId: "m1", text: "Alice: Approved." },
};

const actionItem = {
  externalId: "cb-1",
  title: "Send the revised deck",
  description: "Send the revised deck to reviewers.",
  assigneeName: "Alice",
  assigneeEmail: "alice@example.com",
  done: false,
};

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  process.env.AUTHORITY_ENABLED = "1";
  insertMeetingJob(db, "m1");
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
  delete process.env.AUTHORITY_ENABLED;
});

function dependencies(meeting: Meeting = baseMeeting) {
  return {
    db,
    getMeeting: vi.fn(async () => meeting),
    loadGroups: vi.fn(() => ({ "all-hands": ["alice@example.com"] })),
    loadAliases: vi.fn(() => ({})),
    normalize: vi.fn(async () => "## Summary\nApproved.\n\n<details><summary>Full transcript</summary></details>"),
    writeNote: vi.fn(async () => undefined),
    extractTasks: vi.fn(async () => undefined),
    now: () => "2026-07-11T11:00:00Z",
  };
}

describe("runMeetingJob", () => {
  it("writes a note and records the ingested source", async () => {
    const deps = dependencies();
    await expect(runMeetingJob("m1", deps)).resolves.toBeUndefined();
    expect(deps.writeNote).toHaveBeenCalledWith(expect.objectContaining({
      path: "docs/meetings/2026/2026-07-11-1000-weekly-review-m1.md",
      authorEmail: getConfig().git.botEmail,
    }));
    expect(getIngestedMeeting(db, "m1")).toMatchObject({
      meetingId: "m1",
      notePath: "docs/meetings/2026/2026-07-11-1000-weekly-review-m1.md",
    });
    expect(getMeetingJob(db, "m1")?.state).toBe("done");
    expect(deps.extractTasks).toHaveBeenCalledWith("m1", {
      notePath: "docs/meetings/2026/2026-07-11-1000-weekly-review-m1.md",
      visibility: ["all-hands"],
      attendees: ["alice@example.com"],
      actionItems: [],
    });
  });

  it("hands the meeting's action items to task extraction", async () => {
    const deps = dependencies({ ...baseMeeting, actionItems: [actionItem] });
    await runMeetingJob("m1", deps);
    expect(deps.extractTasks).toHaveBeenCalledWith("m1", expect.objectContaining({
      actionItems: [actionItem],
    }));
  });

  it("still extracts tasks when the note is unchanged, so late action items land", async () => {
    const first = dependencies();
    await runMeetingJob("m1", first);

    insertMeetingJob(db, "m1");
    // Circleback writes action items minutes after the meeting, so the second
    // poll sees the same note and a longer list.
    const second = dependencies({ ...baseMeeting, actionItems: [actionItem] });
    await runMeetingJob("m1", second);

    expect(second.writeNote).not.toHaveBeenCalled();
    expect(second.extractTasks).toHaveBeenCalledWith("m1", expect.objectContaining({
      actionItems: [actionItem],
    }));
  });

  it("derives visibility through the alias registry", async () => {
    const deps = dependencies({
      ...baseMeeting,
      attendees: [{ email: "alice.personal@gmail.test" }],
    });
    deps.loadAliases.mockReturnValue({ "alice.personal@gmail.test": "alice@example.com" });
    await runMeetingJob("m1", deps);
    // The task's attendee grant is only worth anything if it is stamped with the
    // canonical identity, since that is what a session resolves to on read.
    expect(deps.extractTasks).toHaveBeenCalledWith("m1", expect.objectContaining({
      visibility: ["all-hands"],
      attendees: ["alice@example.com"],
    }));
  });

  it("skips an unchanged source hash", async () => {
    const first = dependencies();
    await runMeetingJob("m1", first);
    insertMeetingJob(db, "m1");
    const second = dependencies();
    await runMeetingJob("m1", second);
    expect(second.normalize).not.toHaveBeenCalled();
    expect(second.writeNote).not.toHaveBeenCalled();
    expect(getMeetingJob(db, "m1")?.state).toBe("done");
  });

  it("updates the original path when the source changes", async () => {
    upsertIngestedMeeting(db, {
      meetingId: "m1",
      notePath: "docs/meetings/2026/original.md",
      sourceHash: "old-hash",
      ingestedAt: "2026-07-11T09:00:00Z",
    });
    const deps = dependencies({ ...baseMeeting, title: "Renamed", transcript: { meetingId: "m1", text: "Revised" } });
    await runMeetingJob("m1", deps);
    expect(deps.writeNote).toHaveBeenCalledWith(expect.objectContaining({ path: "docs/meetings/2026/original.md" }));
    expect(getIngestedMeeting(db, "m1")?.notePath).toBe("docs/meetings/2026/original.md");
  });

  it("writes no note when authority is off", async () => {
    delete process.env.AUTHORITY_ENABLED;
    const deps = dependencies();
    await runMeetingJob("m1", deps);
    expect(deps.getMeeting).not.toHaveBeenCalled();
    expect(deps.writeNote).not.toHaveBeenCalled();
    expect(getMeetingJob(db, "m1")?.state).toBe("error");
  });

  it("never throws and records an error", async () => {
    const deps = dependencies();
    deps.getMeeting.mockRejectedValue(new Error("Circleback unavailable"));
    await expect(runMeetingJob("m1", deps)).resolves.toBeUndefined();
    expect(getMeetingJob(db, "m1")).toMatchObject({ state: "error", error: "Circleback unavailable" });
  });
});
