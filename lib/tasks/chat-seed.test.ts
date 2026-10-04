import { describe, it, expect } from "vitest";
import { taskChatSeed } from "./chat-seed";
import type { TaskRecord } from "@/lib/db/tasks";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "t1",
    title: "Reconcile vault balances",
    description: "The accounting doc lags the latest rebalance.",
    assigneeEmail: "alice@example.com",
    sourceMeetingId: "m1",
    sourceNotePath: "docs/meetings/2026-07-10-standup.md",
    clearance: ["all-hands"],
    sourceAttendees: [],
    status: "open",
    due: "2026-07-18",
    origin: "circleback",
    createdBy: null,
    createdAt: "2026-07-11T00:00:00Z",
    ...overrides,
  };
}

describe("taskChatSeed", () => {
  it("includes the title, description, source note, due, and assignee", () => {
    const seed = taskChatSeed(task());
    expect(seed).toContain("Reconcile vault balances");
    expect(seed).toContain("The accounting doc lags the latest rebalance.");
    expect(seed).toContain("docs/meetings/2026-07-10-standup.md");
    expect(seed).toContain("Due: 2026-07-18");
    expect(seed).toContain("Assignee: alice@example.com");
    expect(seed).toMatch(/read the source note/i);
  });

  it("omits optional lines that are absent", () => {
    const seed = taskChatSeed(task({ due: null, assigneeEmail: null, description: "  " }));
    expect(seed).not.toContain("Due:");
    expect(seed).not.toContain("Assignee:");
    // Still names the source note for grounding.
    expect(seed).toContain("Source meeting note:");
  });

  it("drops the meeting framing for a manual task with no source note", () => {
    const seed = taskChatSeed(task({ sourceMeetingId: null, sourceNotePath: null, origin: "manual" }));
    expect(seed).not.toContain("Source meeting note:");
    expect(seed).not.toContain("null");
    expect(seed).not.toMatch(/action item from a meeting/i);
    expect(seed).toContain("Reconcile vault balances");
  });
});

describe("taskChatSeed assignee resolution", () => {
  it("names the assignee and keeps the address, so the agent can still act on it", () => {
    const seed = taskChatSeed(task(), { assigneeName: "Alice Adams" });
    expect(seed).toContain("Assignee: Alice Adams (alice@example.com)");
  });

  it("falls back to the bare address with no resolved name (the people flag off)", () => {
    expect(taskChatSeed(task())).toContain("Assignee: alice@example.com");
  });

  it("does not repeat the address when the resolver handed back the address itself", () => {
    const seed = taskChatSeed(task(), { assigneeName: "alice@example.com" });
    expect(seed).toContain("Assignee: alice@example.com");
    expect(seed).not.toContain("alice@example.com (alice@example.com)");
  });
});
