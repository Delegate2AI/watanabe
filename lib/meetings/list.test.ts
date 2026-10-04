import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listMeetingNotes } from "./list";

describe("listMeetingNotes", () => {
  it("lists only meeting notes present in the clearance-scoped root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meetings-list-"));
    const directory = path.join(root, "meetings", "2026");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "visible.md"), [
      "---",
      'title: "Visible Review"',
      "type: meeting",
      'date: "2026-07-11T10:00:00Z"',
      "duration_minutes: 30",
      "attendees:",
      '  - "alice@example.com"',
      "visibility:",
      '  - "exec"',
      "---",
      "Body",
    ].join("\n"));
    fs.writeFileSync(path.join(directory, "not-a-meeting.md"), "---\ntype: memo\n---\nBody");

    expect(listMeetingNotes(["all-hands", "exec"], root)).toEqual([{
      title: "Visible Review",
      date: "2026-07-11T10:00:00Z",
      attendeeCount: 1,
      durationMinutes: 30,
      visibility: "restricted",
      group: "Exec",
      href: "/kb/meetings/2026/visible",
      notePath: "meetings/2026/visible.md",
      visibilityGroups: ["exec"],
      attendees: ["alice@example.com"],
    }]);
  });
});
