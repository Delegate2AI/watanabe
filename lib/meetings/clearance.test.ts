import { describe, expect, it } from "vitest";
import type { Groups } from "@/lib/authority/groups";
import { deriveMeetingVisibility } from "./clearance";

const groups: Groups = {
  "all-hands": ["alice@example.com", "bob@example.com", "carol@example.com"],
  exec: ["alice@example.com"],
  product: ["bob@example.com"],
  admins: ["admin@example.com"],
};

// Circleback exposes no internal/external attendee flag, so membership in the
// access groups IS the internal signal: a grouped email is internal, anything
// else is uncertainty.

describe("deriveMeetingVisibility", () => {
  it("keeps an all-internal all-hands meeting visible to all hands", () => {
    expect(deriveMeetingVisibility([{ email: "carol@example.com" }], groups)).toEqual(["all-hands"]);
  });

  it("treats an attendee with no email as uncertainty, not as absent", () => {
    // Circleback sends `email: null` for a participant it has no address for
    // (observed on a real prod delivery, 2026-08-07). That attendee cannot be
    // resolved, so they are exactly the uncertainty signal that keeps a
    // meeting off all-hands. Dropping them instead would WIDEN visibility.
    expect(deriveMeetingVisibility([{ email: "carol@example.com" }, { name: "Nick" }], groups))
      .toEqual(["admins"]);
  });

  it("fails closed for an unknown attendee", () => {
    expect(deriveMeetingVisibility([{ email: "unknown@example.com" }], groups)).toEqual(["admins"]);
  });

  it("fails closed for an empty attendee list (no identified participants)", () => {
    // A recording with no identified attendees is absence-of-data, not an
    // all-internal meeting. It must never publish to all-hands.
    expect(deriveMeetingVisibility([], groups)).toEqual(["admins"]);
  });

  it("removes all-hands when an ungrouped attendee is present", () => {
    expect(deriveMeetingVisibility([
      { email: "alice@example.com" },
      { email: "guest@outside.test" },
    ], groups)).toEqual(["exec"]);
  });

  it("matches group membership case-insensitively", () => {
    expect(deriveMeetingVisibility([{ email: "Carol@Example.com" }], groups)).toEqual(["all-hands"]);
  });

  it("unions the groups of known internal attendees", () => {
    expect(deriveMeetingVisibility([
      { email: "alice@example.com" },
      { email: "bob@example.com" },
    ], groups)).toEqual(["all-hands", "exec", "product"]);
  });

  it("resolves an aliased attendee to their canonical identity before the group lookup", () => {
    const aliases = { "alice.personal@gmail.test": "alice@example.com" };
    expect(deriveMeetingVisibility([{ email: "Alice.Personal@gmail.test" }], groups, aliases))
      .toEqual(["all-hands", "exec"]);
  });

  it("still fails closed for an unaliased personal address", () => {
    const aliases = { "alice.personal@gmail.test": "alice@example.com" };
    expect(deriveMeetingVisibility([{ email: "stranger@gmail.test" }], groups, aliases))
      .toEqual(["admins"]);
  });
});
