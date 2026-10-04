import { afterEach, describe, expect, it } from "vitest";
import { isMeetingsEnabled, meetingNameFilter } from "./config";

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.MEETINGS_NAME_FILTER;
});

describe("isMeetingsEnabled", () => {
  it("defaults off and enables only for 1", () => {
    expect(isMeetingsEnabled()).toBe(false);
    process.env.MEETINGS_ENABLED = "1";
    expect(isMeetingsEnabled()).toBe(true);
    process.env.MEETINGS_ENABLED = "true";
    expect(isMeetingsEnabled()).toBe(false);
  });
});

describe("meetingNameFilter", () => {
  it("defaults to no filter and returns the trimmed value when set", () => {
    expect(meetingNameFilter()).toBeNull();
    process.env.MEETINGS_NAME_FILTER = "  atlas  ";
    expect(meetingNameFilter()).toBe("atlas");
    process.env.MEETINGS_NAME_FILTER = "   ";
    expect(meetingNameFilter()).toBeNull();
  });
});
