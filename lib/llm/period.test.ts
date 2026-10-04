import { describe, expect, it } from "vitest";
import { periodBounds } from "./period";

describe("periodBounds", () => {
  const at = new Date("2026-10-03T21:15:00Z");

  it("starts a day at 00:00 UTC", () => {
    expect(periodBounds("day", at)).toEqual({ start: "2026-10-03", resetAt: "2026-10-04T00:00:00.000Z" });
  });

  it("starts a week on Monday", () => {
    expect(periodBounds("week", at)).toEqual({ start: "2026-09-28", resetAt: "2026-10-05T00:00:00.000Z" });
  });

  it("treats a Sunday as the end of the week, not the start", () => {
    expect(periodBounds("week", new Date("2026-10-04T23:59:59Z")).start).toBe("2026-09-28");
  });

  it("starts a month on the 1st and rolls the year in December", () => {
    expect(periodBounds("month", at)).toEqual({ start: "2026-10-01", resetAt: "2026-11-01T00:00:00.000Z" });
    expect(periodBounds("month", new Date("2026-12-31T23:00:00Z")).resetAt).toBe("2027-01-01T00:00:00.000Z");
  });
});
