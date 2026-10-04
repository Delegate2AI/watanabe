import { describe, it, expect } from "vitest";
import { readKbTag, kbTagTitle, meetingDateKey, plainHeading, withMeetingDate } from "./doc-title";

const TAGGED = `<!-- KB-TAG v1 ============================================
kb.id:             MERIDIAN-ECON-TOKEN
kb.title:          Meridian Tokenomics
kb.version:        v6.4
kb.superseded_by:  -
kb.learn:          YES
========================================================== -->

# **1\\. Key Token Stats**
`;

describe("readKbTag", () => {
  it("reads the comment header DL-037 requires, dropping unset fields", () => {
    const fields = readKbTag(TAGGED);
    expect(fields.id).toBe("MERIDIAN-ECON-TOKEN");
    expect(fields.version).toBe("v6.4");
    expect(fields).not.toHaveProperty("superseded_by");
  });

  it("is empty for a note with no tag, and for a tag past the scan window", () => {
    expect(readKbTag("# Just a note\n")).toEqual({});
    expect(readKbTag("x".repeat(4000) + TAGGED)).toEqual({});
  });
});

describe("kbTagTitle", () => {
  it("takes a title that says something the filename does not", () => {
    expect(kbTagTitle(TAGGED, "economics/Meridian_Tokenomics_v6_4.md")).toBe("Meridian Tokenomics");
  });

  it("ignores a title that only echoes the stem, which is most of the vault today", () => {
    const echoed = TAGGED.replace("Meridian Tokenomics", "Meridian_Tokenomics_v6_4");
    expect(kbTagTitle(echoed, "economics/Meridian_Tokenomics_v6_4.md")).toBeUndefined();
  });

  it("ignores a filename-shaped title even when it differs from the stem", () => {
    const shaped = TAGGED.replace("Meridian Tokenomics", "Meridian_Tokenomics");
    expect(kbTagTitle(shaped, "economics/Meridian_Tokenomics_v6_4.md")).toBeUndefined();
  });
});

describe("plainHeading", () => {
  it("strips emphasis, code ticks and escapes from a heading lifted as a title", () => {
    expect(plainHeading("**I.  Executive Summary**")).toBe("I. Executive Summary");
    expect(plainHeading("**1\\. Key Token Stats**")).toBe("1. Key Token Stats");
    expect(plainHeading("The `kb.id` field")).toBe("The kb.id field");
  });

  it("leaves lone underscores and asterisks alone", () => {
    expect(plainHeading("PACKAGE CONTENTS, INSIGHT_LABS_OS_v1")).toBe(
      "PACKAGE CONTENTS, INSIGHT_LABS_OS_v1",
    );
  });

  it("passes an ordinary title through untouched", () => {
    expect(plainHeading("Stage 1 · The Target")).toBe("Stage 1 · The Target");
  });
});

const meetingNote = (fm: string) => `---\n${fm}\n---\n\nNotes.\n`;

describe("withMeetingDate", () => {
  it("leads a meeting title with its date and time so repeated instances are told apart", () => {
    const content = meetingNote('type: meeting\ndate: "2026-08-18T12:02:08.300Z"');
    expect(withMeetingDate("Acme Markets Daily Sync", content)).toBe(
      "2026-08-18 12:02 UTC · Acme Markets Daily Sync",
    );
  });

  it("has a short form for narrow columns: day, month, and time, with year and zone left to the tooltip", () => {
    const content = meetingNote('type: meeting\ndate: "2026-08-18T12:02:08.300Z"');
    expect(withMeetingDate("Acme Markets Daily Sync", content, "short")).toBe(
      "18 Aug 12:02 · Acme Markets Daily Sync",
    );
    expect(withMeetingDate("Dev Sync", meetingNote('type: meeting\ndate: "2026-03-05T09:07:00Z"'), "short")).toBe(
      "05 Mar 09:07 · Dev Sync",
    );
    expect(withMeetingDate("Doctrine", meetingNote('type: canon\ndate: "2026-08-18"'), "short")).toBe("Doctrine");
  });

  it("zero-pads the stamp so a column of them sorts as it reads", () => {
    const content = meetingNote('type: meeting\ndate: "2026-03-05T09:07:00Z"');
    expect(withMeetingDate("Dev Sync", content)).toBe("2026-03-05 09:07 UTC · Dev Sync");
  });

  it("leaves a non-meeting, an undated meeting, and an unparseable date alone", () => {
    expect(withMeetingDate("Doctrine", meetingNote('type: canon\ndate: "2026-08-18"'))).toBe(
      "Doctrine",
    );
    expect(withMeetingDate("Dev Sync", meetingNote("type: meeting"))).toBe("Dev Sync");
    expect(withMeetingDate("Dev Sync", meetingNote('type: meeting\ndate: whenever'))).toBe(
      "Dev Sync",
    );
    expect(withMeetingDate("Doctrine", "# Doctrine\n")).toBe("Doctrine");
  });
});

describe("meetingDateKey", () => {
  it("returns the ingest's ISO instant for a dated meeting note", () => {
    expect(meetingDateKey(meetingNote('type: meeting\ndate: "2026-08-18T12:02:08.300Z"'))).toBe(
      "2026-08-18T12:02:08.300Z",
    );
  });

  it("normalizes an offset so string order stays time order", () => {
    // 14:02 at +02:00 is 12:02 UTC, and must not sort after a 13:00Z note.
    expect(meetingDateKey(meetingNote('type: meeting\ndate: "2026-08-18T14:02:08+02:00"'))).toBe(
      "2026-08-18T12:02:08.000Z",
    );
  });

  it("is null for a non-meeting, an undated meeting, and an unparseable date", () => {
    expect(meetingDateKey(meetingNote('type: canon\ndate: "2026-08-18"'))).toBeNull();
    expect(meetingDateKey(meetingNote("type: meeting"))).toBeNull();
    expect(meetingDateKey(meetingNote("type: meeting\ndate: whenever"))).toBeNull();
    expect(meetingDateKey("# Doctrine\n")).toBeNull();
  });
});
