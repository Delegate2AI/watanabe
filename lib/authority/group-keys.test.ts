import { describe, it, expect, vi, beforeEach } from "vitest";

const loadAccessMock = vi.fn();
vi.mock("./access", () => ({ loadAccess: () => loadAccessMock() }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));

const { checkGroups, unknownGroups, ALL_HANDS, MAX_CLEARANCE_GROUPS, MAX_GROUP_KEY_CHARS } =
  await import("./group-keys");

beforeEach(() => {
  loadAccessMock.mockReset().mockReturnValue({ groups: { engineering: [], marketing: [] } });
});

describe("unknownGroups", () => {
  it("accepts a declared group", () => {
    expect(unknownGroups(["engineering"])).toEqual([]);
  });

  it("rejects a typo, which is the whole point of the check", () => {
    expect(unknownGroups(["enginering"])).toEqual(["enginering"]);
  });

  // `all-hands` is the universal clearance: implicit, so absent from
  // groups.yaml, but carried by every caller. Rejecting it made skills and
  // connectors the only subsystems that could not be offered workspace-wide.
  it("accepts all-hands even though groups.yaml never declares it", () => {
    expect(unknownGroups([ALL_HANDS])).toEqual([]);
    expect(unknownGroups([ALL_HANDS, "engineering"])).toEqual([]);
  });

  it("still fails closed for real keys when access cannot be read", () => {
    loadAccessMock.mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(unknownGroups(["engineering"])).toEqual(["engineering"]);
    // all-hands needs no lookup to be valid, so an unreadable file cannot
    // strand the one key that always resolves.
    expect(unknownGroups([ALL_HANDS])).toEqual([]);
  });
});

describe("checkGroups", () => {
  it("de-duplicates and sorts, so a committed list is stable", () => {
    expect(checkGroups(["marketing", "engineering", "marketing"])).toEqual({
      ok: true,
      groups: ["engineering", "marketing"],
    });
  });

  it("passes all-hands through", () => {
    expect(checkGroups([ALL_HANDS])).toEqual({ ok: true, groups: [ALL_HANDS] });
  });

  it("refuses an unknown key", () => {
    expect(checkGroups(["nope"])).toEqual({ ok: false });
  });

  it("refuses an empty or oversized key, and an oversized list", () => {
    expect(checkGroups([" "])).toEqual({ ok: false });
    expect(checkGroups(["x".repeat(MAX_GROUP_KEY_CHARS + 1)])).toEqual({ ok: false });
    expect(checkGroups(Array(MAX_CLEARANCE_GROUPS + 1).fill("engineering"))).toEqual({ ok: false });
  });

  it("treats an empty list as 'nobody yet', not an error", () => {
    expect(checkGroups([])).toEqual({ ok: true, groups: [] });
  });
});
