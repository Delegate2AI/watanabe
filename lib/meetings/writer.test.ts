import { describe, expect, it } from "vitest";
import { meetingNoteViolations, vaultRelativePath } from "./writer";

// Meeting notes are a RECORD of what attendees said, cited as a whole via the
// `source: circleback:<id>` frontmatter. Attendees say things like "$20K" and
// "two weeks", so the prose gates for uncited figures and time estimates do
// not apply; only the style gate (em dash) does.
describe("meetingNoteViolations", () => {
  it("allows figures and time estimates quoted from the meeting", () => {
    expect(meetingNoteViolations([
      "Invoice of $20K is outstanding.",
      "Payment expected within 2 weeks of submission.",
    ])).toEqual([]);
  });

  it("still rejects em dashes", () => {
    const violations = meetingNoteViolations(["Metro unpaid \u2014 escalation ongoing."]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("em-dash");
  });
});

// The write-path doctrine allow-lists meeting notes to docs/meetings/. This guard
// is the single containment point, so its deny paths are asserted directly.
describe("vaultRelativePath", () => {
  it("accepts a path under docs/meetings/ and strips the docs/ vault prefix", () => {
    expect(vaultRelativePath("docs/meetings/2026-07-11-sync.md")).toBe("meetings/2026-07-11-sync.md");
  });

  it("rejects a path outside docs/meetings/", () => {
    expect(() => vaultRelativePath("docs/secrets/roles.yaml")).toThrow(/docs\/meetings/);
    expect(() => vaultRelativePath("helm/values.yaml")).toThrow(/docs\/meetings/);
  });

  it("rejects a traversal that escapes the vault", () => {
    expect(() => vaultRelativePath("docs/meetings/../../etc/passwd")).toThrow(/unsafe|docs\/meetings/);
  });

  it("rejects a backslash separator", () => {
    expect(() => vaultRelativePath("docs/meetings\\note.md")).toThrow(/docs\/meetings/);
  });
});
