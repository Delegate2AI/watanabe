import { describe, expect, it } from "vitest";
import { resolveAssignee } from "./resolve";
import type { RawTaskItem } from "./seed";

const groups = {
  "all-hands": ["alice@example.com", "bob@example.com"],
  exec: ["alice@example.com"],
};

function item(overrides: Partial<RawTaskItem> = {}): RawTaskItem {
  return {
    externalId: "1",
    title: "Send the revised deck",
    description: "Send the revised deck to reviewers.",
    assigneeName: "Alice Chen",
    assigneeEmail: "alice@example.com",
    ...overrides,
  };
}

describe("resolveAssignee", () => {
  it("assigns a group member from the address Circleback supplied", () => {
    expect(resolveAssignee(item(), groups, {})).toBe("alice@example.com");
  });

  it("matches regardless of the case the meeting system used", () => {
    expect(resolveAssignee(item({ assigneeEmail: "Alice@Example.com" }), groups, {})).toBe("alice@example.com");
  });

  it("resolves a personal meeting address to the canonical identity", () => {
    const aliases = { "alice.personal@gmail.test": "alice@example.com" };
    expect(resolveAssignee(item({ assigneeEmail: "alice.personal@gmail.test" }), groups, aliases))
      .toBe("alice@example.com");
  });

  it("leaves the task unassigned rather than guessing", () => {
    // An outsider on the call, and an item Circleback left unassigned.
    expect(resolveAssignee(item({ assigneeEmail: "vendor@outside.test" }), groups, {})).toBeNull();
    expect(resolveAssignee(item({ assigneeEmail: null }), groups, {})).toBeNull();
  });

  it("does not assign on name alone when the address is unknown", () => {
    expect(resolveAssignee(item({ assigneeName: "Alice Chen", assigneeEmail: "someone.else@outside.test" }), groups, {}))
      .toBeNull();
  });
});
