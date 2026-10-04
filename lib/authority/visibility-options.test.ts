import { describe, it, expect, vi, beforeEach } from "vitest";

const loadGroupsMock = vi.fn();
vi.mock("./groups", () => ({ loadGroups: () => loadGroupsMock() }));

const { visibilityOptionsFor } = await import("./visibility-options");

beforeEach(() => loadGroupsMock.mockReset());

/** What `resolvePerson` returns with the people flag off: the address itself. */
function person(email: string) {
  return { email, name: email, initials: email.charAt(0).toUpperCase(), isSelf: false };
}

describe("visibilityOptionsFor", () => {
  it("offers all-hands plus only the groups in the caller's clearance, and their people", () => {
    loadGroupsMock.mockReturnValue({
      exec: ["alice@example.com", "bob@example.com"],
      board: ["carol@example.com"],
    });
    const options = visibilityOptionsFor(["all-hands", "exec"]);
    // board is not in the caller's clearance, so neither it nor carol appears.
    expect(options.groups).toEqual(["all-hands", "exec"]);
    // Flag-off (PEOPLE_ENABLED unset here), the resolved person's name IS the
    // address, so the option label is byte-identical to what it was before the
    // directory existed.
    expect(options.people).toEqual([
      { email: "alice@example.com", groups: ["exec"], person: person("alice@example.com") },
      { email: "bob@example.com", groups: ["exec"], person: person("bob@example.com") },
    ]);
  });

  it("returns just all-hands when there are no groups (authority off)", () => {
    loadGroupsMock.mockReturnValue({});
    expect(visibilityOptionsFor(["all-hands"])).toEqual({ groups: ["all-hands"], people: [] });
  });

  it("lists every clearance group a person belongs to", () => {
    loadGroupsMock.mockReturnValue({ exec: ["alice@example.com"], board: ["alice@example.com"] });
    const options = visibilityOptionsFor(["all-hands", "exec", "board"]);
    expect(options.people).toEqual([
      { email: "alice@example.com", groups: ["board", "exec"], person: person("alice@example.com") },
    ]);
  });
});
