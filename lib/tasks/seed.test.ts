import { describe, expect, it } from "vitest";
import type { ActionItem } from "@/lib/meetings/circleback";
import { seedFromMeeting } from "./seed";

function actionItem(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    externalId: "1",
    title: "Send the revised deck",
    description: "Send the revised deck to reviewers.",
    assigneeName: "Alice Chen",
    assigneeEmail: "alice@example.com",
    done: false,
    ...overrides,
  };
}

describe("seedFromMeeting", () => {
  it("carries every attendee's items, not just one person's", () => {
    const items = seedFromMeeting([
      actionItem({ externalId: "1", assigneeName: "Alice Chen", assigneeEmail: "alice@example.com" }),
      actionItem({ externalId: "2", assigneeName: "Bob Ortiz", assigneeEmail: "bob@example.com" }),
      actionItem({ externalId: "3", assigneeName: "Cass Lee", assigneeEmail: "cass@example.com" }),
    ]);
    expect(items.map((item) => item.assigneeEmail)).toEqual([
      "alice@example.com",
      "bob@example.com",
      "cass@example.com",
    ]);
  });

  it("keeps Circleback's title and description verbatim", () => {
    expect(seedFromMeeting([actionItem()])[0]).toEqual({
      externalId: "1",
      title: "Send the revised deck",
      description: "Send the revised deck to reviewers.",
      assigneeName: "Alice Chen",
      assigneeEmail: "alice@example.com",
    });
  });

  it("skips items already marked done upstream", () => {
    expect(seedFromMeeting([actionItem({ externalId: "1", done: true }), actionItem({ externalId: "2" })]))
      .toHaveLength(1);
  });

  it("falls back to the title when the description is empty", () => {
    expect(seedFromMeeting([actionItem({ description: "" })])[0].description).toBe("Send the revised deck");
  });

  it("drops duplicates and untitled items, and tolerates an empty list", () => {
    expect(seedFromMeeting([actionItem(), actionItem()])).toHaveLength(1);
    expect(seedFromMeeting([actionItem({ title: "   " })])).toEqual([]);
    expect(seedFromMeeting([])).toEqual([]);
  });

  it("keeps an unassigned item rather than dropping the work", () => {
    const items = seedFromMeeting([actionItem({ assigneeName: null, assigneeEmail: null })]);
    expect(items).toHaveLength(1);
    expect(items[0].assigneeEmail).toBeNull();
  });
});
