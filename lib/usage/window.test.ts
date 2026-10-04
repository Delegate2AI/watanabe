import { describe, expect, it } from "vitest";
import { defaultUsagePeriod, isUsageDay, utcDayWindow } from "./window";

describe("isUsageDay", () => {
  it("accepts a real UTC day and refuses anything else", () => {
    expect(isUsageDay("2026-09-07")).toBe(true);
    expect(isUsageDay("2026-02-30")).toBe(false);
    expect(isUsageDay("2026-9-7")).toBe(false);
    expect(isUsageDay("2026-09-07T00:00:00Z")).toBe(false);
    expect(isUsageDay("")).toBe(false);
  });
});

describe("utcDayWindow", () => {
  it("puts the whole of the `to` day inside a half-open window", () => {
    expect(utcDayWindow("2026-09-01", "2026-09-01")).toEqual({
      fromTs: "2026-09-01T00:00:00.000Z",
      toTs: "2026-09-02T00:00:00.000Z",
    });
  });

  it("crosses a month boundary", () => {
    expect(utcDayWindow("2026-08-31", "2026-09-02").toTs).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("defaultUsagePeriod", () => {
  it("is the thirty UTC days ending today, inclusive of both ends", () => {
    expect(defaultUsagePeriod(new Date("2026-09-07T18:30:00.000Z"))).toEqual({
      from: "2026-08-09",
      to: "2026-09-07",
    });
  });
});
