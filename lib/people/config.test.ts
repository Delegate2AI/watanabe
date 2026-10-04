import { afterEach, describe, expect, it } from "vitest";
import { isPeopleEnabled, isPeopleActivityEnabled } from "./config";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("isPeopleEnabled", () => {
  it("is off when the env var is unset", () => {
    delete process.env.PEOPLE_ENABLED;
    expect(isPeopleEnabled()).toBe(false);
  });

  it("is off for any value other than 1", () => {
    process.env.PEOPLE_ENABLED = "true";
    expect(isPeopleEnabled()).toBe(false);
  });

  it("is on for 1", () => {
    process.env.PEOPLE_ENABLED = "1";
    expect(isPeopleEnabled()).toBe(true);
  });
});

describe("isPeopleActivityEnabled", () => {
  it("is off when the env var is unset", () => {
    delete process.env.PEOPLE_ACTIVITY_ENABLED;
    expect(isPeopleActivityEnabled()).toBe(false);
  });

  it("is on for 1", () => {
    process.env.PEOPLE_ACTIVITY_ENABLED = "1";
    expect(isPeopleActivityEnabled()).toBe(true);
  });

  // The two flags are independent: the dashboard does not need the directory.
  it("does not follow PEOPLE_ENABLED", () => {
    process.env.PEOPLE_ENABLED = "1";
    delete process.env.PEOPLE_ACTIVITY_ENABLED;
    expect(isPeopleActivityEnabled()).toBe(false);
  });
});
