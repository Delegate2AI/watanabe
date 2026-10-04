import { describe, it, expect, vi, beforeEach } from "vitest";

const groupSharingMock = vi.fn();
vi.mock("./config", () => ({ isDocGroupSharingEnabled: () => groupSharingMock() }));

const unknownGroupsMock = vi.fn();
vi.mock("@/lib/authority/group-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/group-keys")>();
  return { ...actual, unknownGroups: (g: string[]) => unknownGroupsMock(g) };
});

const clearanceMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (email: string) => clearanceMock(email),
}));

const isAdminMock = vi.fn();
vi.mock("@/lib/authority/groups", () => ({
  isAdmin: (email: string) => isAdminMock(email),
  loadGroups: () => ({}),
}));

const { validateShareTarget } = await import("./share-target");

const ALICE = "alice@example.com";

beforeEach(() => {
  groupSharingMock.mockReset().mockReturnValue(true);
  unknownGroupsMock.mockReset().mockReturnValue([]);
  clearanceMock.mockReset().mockReturnValue(["all-hands", "engineering"]);
  isAdminMock.mockReset().mockReturnValue(false);
});

const user = (recipient: string) => ({ recipient, kind: "user" as const });
const group = (recipient: string) => ({ recipient, kind: "group" as const });

describe("validateShareTarget: people", () => {
  it("accepts any other address", () => {
    expect(validateShareTarget(user("bob@example.com"), ALICE)).toEqual({ ok: true });
  });

  it("refuses a self-share, case and whitespace insensitively", () => {
    expect(validateShareTarget(user(ALICE), ALICE)).toEqual({ ok: false, reason: "self" });
    expect(validateShareTarget(user("  ALICE@Example.com "), ALICE)).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("is unaffected by the team-sharing flag", () => {
    groupSharingMock.mockReturnValue(false);
    expect(validateShareTarget(user("bob@example.com"), ALICE)).toEqual({ ok: true });
  });
});

describe("validateShareTarget: teams", () => {
  it("accepts a declared group the sharer is cleared for", () => {
    expect(validateShareTarget(group("engineering"), ALICE)).toEqual({ ok: true });
  });

  it("refuses every group when the flag is off", () => {
    groupSharingMock.mockReturnValue(false);
    expect(validateShareTarget(group("engineering"), ALICE)).toEqual({
      ok: false,
      reason: "group_sharing_off",
    });
  });

  it("refuses a group groups.yaml does not declare", () => {
    unknownGroupsMock.mockReturnValue(["enginering"]);
    expect(validateShareTarget(group("enginering"), ALICE)).toEqual({
      ok: false,
      reason: "unknown_group",
    });
  });

  it("refuses a declared group the sharer is not in, so the picker is not a membership oracle", () => {
    expect(validateShareTarget(group("finance"), ALICE)).toEqual({
      ok: false,
      reason: "group_not_in_clearance",
    });
  });

  it("lets an admin share with any declared group", () => {
    isAdminMock.mockReturnValue(true);
    expect(validateShareTarget(group("finance"), ALICE)).toEqual({ ok: true });
  });

  it("accepts all-hands for anyone, without needing it declared", () => {
    // The implicit universal group: never in groups.yaml, always in clearance.
    clearanceMock.mockReturnValue(["all-hands"]);
    expect(validateShareTarget(group("all-hands"), ALICE)).toEqual({ ok: true });
  });

  it("trims the key before checking it", () => {
    expect(validateShareTarget(group("  engineering  "), ALICE)).toEqual({ ok: true });
  });
});
