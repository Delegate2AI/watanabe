import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatDue, formatRelative } from "./date";

/** Local noon, so a test never straddles a midnight or a daylight-saving jump. */
const NOW = new Date(2026, 6, 23, 12, 0, 0);

describe("formatDate", () => {
  it("renders an absolute day", () => {
    expect(formatDate("2026-07-23")).toBe("23 Jul 2026");
  });

  it("reads a date-only string as a local day, never the day before", () => {
    // `new Date("2026-07-18")` is UTC midnight, which is 17 Jul in a western
    // timezone. A due date is a calendar day, so it is read as local midnight.
    expect(formatDate("2026-07-18")).toBe("18 Jul 2026");
  });

  it("accepts a Date and a timestamp string", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("5 Jan 2026");
    expect(formatDate("2026-01-05T09:30:00")).toBe("5 Jan 2026");
  });

  it("returns the raw string for an unparseable input, never Invalid Date", () => {
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
});

describe("formatDateTime", () => {
  it("renders an absolute day and time for a timestamp", () => {
    expect(formatDateTime("2026-01-05T09:30:00")).toBe("5 Jan 2026, 09:30");
  });

  it("drops the time for a date-only input", () => {
    expect(formatDateTime("2026-01-05")).toBe("5 Jan 2026");
  });

  it("returns the raw string for an unparseable input", () => {
    expect(formatDateTime("nope")).toBe("nope");
  });
});

describe("formatRelative", () => {
  it("names today, tomorrow, and yesterday", () => {
    expect(formatRelative("2026-07-23", NOW)).toBe("today");
    expect(formatRelative("2026-07-24", NOW)).toBe("tomorrow");
    expect(formatRelative("2026-07-22", NOW)).toBe("yesterday");
  });

  it("counts days in both directions", () => {
    expect(formatRelative("2026-07-26", NOW)).toBe("in 3 days");
    expect(formatRelative("2026-07-20", NOW)).toBe("3 days ago");
  });

  it("counts calendar days, not elapsed hours", () => {
    // 23:00 tonight is still today; 00:30 tomorrow is tomorrow.
    expect(formatRelative(new Date(2026, 6, 23, 23, 0, 0), NOW)).toBe("today");
    expect(formatRelative(new Date(2026, 6, 24, 0, 30, 0), NOW)).toBe("tomorrow");
  });

  it("falls back to an absolute date beyond thirty days either direction", () => {
    expect(formatRelative("2026-06-13", NOW)).toBe("13 Jun 2026");
    expect(formatRelative("2026-09-01", NOW)).toBe("1 Sep 2026");
    expect(formatRelative("2026-08-22", NOW)).toBe("in 30 days");
  });

  it("returns the raw string for an unparseable input", () => {
    expect(formatRelative("whenever", NOW)).toBe("whenever");
    expect(formatRelative(null, NOW)).toBe("");
  });

  it("defaults `now` to the current instant", () => {
    expect(formatRelative(new Date())).toBe("today");
  });
});

describe("formatDue", () => {
  it("flags a past due date and labels it relatively", () => {
    expect(formatDue("2026-07-18", NOW)).toEqual({ label: "5 days ago", isOverdue: true });
  });

  it("does not flag a due date that lands today", () => {
    expect(formatDue("2026-07-23", NOW)).toEqual({ label: "today", isOverdue: false });
  });

  it("does not flag a future due date", () => {
    expect(formatDue("2026-07-30", NOW)).toEqual({ label: "in 7 days", isOverdue: false });
  });

  it("never flags an unparseable due date", () => {
    expect(formatDue("someday", NOW)).toEqual({ label: "someday", isOverdue: false });
    expect(formatDue(null, NOW)).toEqual({ label: "", isOverdue: false });
  });
});
