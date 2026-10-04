import { describe, it, expect, vi, beforeEach } from "vitest";

const loadGroupsMock = vi.fn();
vi.mock("./groups", () => ({ loadGroups: () => loadGroupsMock() }));

const { knownMemberEmails } = await import("./known-people");

beforeEach(() => loadGroupsMock.mockReset());

describe("knownMemberEmails", () => {
  it("unions members across groups, unique and sorted", () => {
    loadGroupsMock.mockReturnValue({
      exec: ["bob@example.com", "alice@example.com"],
      board: ["alice@example.com", "carol@example.com"],
    });
    expect(knownMemberEmails()).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });

  it("is empty when there are no groups (authority off)", () => {
    loadGroupsMock.mockReturnValue({});
    expect(knownMemberEmails()).toEqual([]);
  });
});
