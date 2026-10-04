import { describe, it, expect } from "vitest";
import { attendedBy } from "./attendance";

const ALIASES = { "alice.personal@gmail.test": "alice@example.com" };

describe("attendedBy", () => {
  it("matches the viewer on the attendee list", () => {
    expect(attendedBy(["alice@example.com", "bob@example.com"], "alice@example.com", {})).toBe(true);
  });

  it("does not match a viewer who was not there", () => {
    expect(attendedBy(["bob@example.com"], "alice@example.com", {})).toBe(false);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    expect(attendedBy(["  Alice@Example.com "], "ALICE@example.com", {})).toBe(true);
  });

  it("matches when the meeting records the viewer's alias", () => {
    expect(attendedBy(["alice.personal@gmail.test"], "alice@example.com", ALIASES)).toBe(true);
  });

  it("matches when the session authenticates under an alias", () => {
    expect(attendedBy(["alice@example.com"], "alice.personal@gmail.test", ALIASES)).toBe(true);
  });

  it("is false for an empty viewer address", () => {
    expect(attendedBy(["alice@example.com"], "", {})).toBe(false);
  });
});
