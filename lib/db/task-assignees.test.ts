import { describe, expect, it } from "vitest";
import { assigneeWrite, assigneesFromRow, normalizeAssignees } from "./task-assignees";

describe("normalizeAssignees", () => {
  it("trims, lower-cases and keeps the given order", () => {
    expect(normalizeAssignees([" Ken@Example.com ", "angel@example.com"])).toEqual(["ken@example.com", "angel@example.com"]);
  });

  it("drops blanks, nulls and repeats", () => {
    expect(normalizeAssignees(["ken@example.com", "  ", null, undefined, "KEN@example.com"])).toEqual(["ken@example.com"]);
  });
});

describe("assigneeWrite", () => {
  it("makes the first assignee the primary", () => {
    expect(assigneeWrite(["ken@example.com", "angel@example.com"])).toEqual({
      assignees: '["ken@example.com","angel@example.com"]',
      assigneeEmail: "ken@example.com",
    });
  });

  it("writes an empty list as unassigned", () => {
    expect(assigneeWrite([])).toEqual({ assignees: "[]", assigneeEmail: null });
  });
});

describe("assigneesFromRow", () => {
  it("reads the stored list", () => {
    expect(assigneesFromRow('["ken@example.com","angel@example.com"]', "ken@example.com")).toEqual(["ken@example.com", "angel@example.com"]);
  });

  // A row written before v35 and never rewritten: the column defaults to '[]'
  // while assignee_email still names the one person who owns the task.
  it("falls back to the primary column when the list is empty", () => {
    expect(assigneesFromRow("[]", "ken@example.com")).toEqual(["ken@example.com"]);
  });

  it("reads an unassigned row as nobody", () => {
    expect(assigneesFromRow("[]", null)).toEqual([]);
  });

  it("treats a malformed list as the primary alone", () => {
    expect(assigneesFromRow("{oops", "ken@example.com")).toEqual(["ken@example.com"]);
  });
});
