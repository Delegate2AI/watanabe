import { describe, expect, it, vi } from "vitest";
import type { Meeting } from "./circleback";
import { buildNote, normalizeMeeting, slugFor } from "./normalize";

const meeting: Meeting = {
  id: "meet-123",
  title: "Weekly Product Review",
  startAt: "2026-07-11T10:00:00Z",
  endAt: "2026-07-11T10:30:00Z",
  attendees: [{ name: "Alice", email: "alice@example.com" }],
  tags: ["weekly"],
  transcript: { meetingId: "meet-123", text: "Alice: We approved the launch." },
};

describe("frontmatter attendees", () => {
  it("lists only attendees that have an address, never a blank entry", () => {
    // The frontmatter list is the join key for clearance and the people
    // surfaces, so an attendee with no email belongs in the metadata the
    // normalizer agent sees, not as `- ""` in the note.
    const note = buildNote(
      { ...meeting, attendees: [{ name: "Nina Doe" }, { email: "alice@example.com" }] },
      "## Summary\nBody.",
      ["admins"],
    );
    // JSON.stringify(undefined) is `undefined`, not a quoted string, so a
    // missing address would land as a bare `- undefined` list item. Assert the
    // whole attendees block rather than the absence of one bad spelling.
    expect(note).toContain('attendees:\n  - "alice@example.com"\nsource:');
  });
});

describe("normalizeMeeting", () => {
  it("uses the headless normalizer result", async () => {
    const run = vi.fn(async () => "## Summary\nLaunch approved.\n\n## Decisions\nLaunch.\n\n## Action items\nNone.");
    const result = await normalizeMeeting(meeting, run);
    expect(result).toContain("Full transcript");
    expect(result).toContain("**Alice:** We approved the launch.");
    expect(run).toHaveBeenCalledWith(meeting);
  });
});

describe("em dash sanitation", () => {
  it("replaces em dashes from the normalizer summary so the mechanical gate passes", async () => {
    const run = vi.fn(async () => "## Summary\nMetro unpaid \u2014 escalation ongoing.\n\n## Decisions\nNone.\n\n## Action items\nNone.");
    const result = await normalizeMeeting(meeting, run);
    expect(result).not.toMatch(/[\u2014\u2015]/);
    expect(result).toContain("Metro unpaid, escalation ongoing.");
  });

  it("sanitizes em dashes arriving via meeting title and transcript", () => {
    const dashed: Meeting = {
      ...meeting,
      title: "Planning \u2014 Q3",
      transcript: { meetingId: "meet-123", text: "Alice: budget \u2014 pending" },
    };
    const note = buildNote(dashed, "## Summary\nFine.", ["exec"]);
    expect(note).not.toMatch(/[\u2014\u2015]/);
    expect(note).toContain('title: "Planning, Q3"');
  });
});

describe("buildNote", () => {
  it("assembles required frontmatter and normalized body", () => {
    const note = buildNote(meeting, "## Summary\nLaunch approved.\n\n<details><summary>Full transcript</summary></details>", ["exec"]);
    expect(note).toContain("type: meeting");
    expect(note).toContain('date: "2026-07-11T10:00:00Z"');
    expect(note).toContain('source: "circleback:meet-123"');
    expect(note).toContain('  - "alice@example.com"');
    expect(note).toContain('  - "exec"');
    expect(note).toContain("Full transcript");
  });

  it("builds a year-scoped path led by the UTC date and time, with the meeting id as tie-breaker", () => {
    expect(slugFor(meeting)).toBe("docs/meetings/2026/2026-07-11-1000-weekly-product-review-meet-123.md");
  });

  it("zero-pads the stamp so two notes in one folder sort as they read", () => {
    const early = { ...meeting, id: "Meet/9", title: "Q&A: Fees!", startAt: "2026-03-05T09:07:00Z" };
    expect(slugFor(early)).toBe("docs/meetings/2026/2026-03-05-0907-q-a-fees-meet-9.md");
  });
});
