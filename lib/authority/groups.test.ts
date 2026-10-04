import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allMembers, assignableMembers, canSee, isAdmin, isKnownMember, loadGroups, resolveClearance } from "./groups";

let root: string;
let groupsPath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "authority-groups-"));
  groupsPath = path.join(root, "groups.yaml");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("loadGroups", () => {
  it("parses a valid groups file", () => {
    writeFileSync(
      groupsPath,
      "groups:\n  admins: [admin@example.com]\n  exec: [exec@example.com, admin@example.com]\n",
    );

    expect(loadGroups(groupsPath)).toEqual({
      admins: ["admin@example.com"],
      exec: ["exec@example.com", "admin@example.com"],
    });
  });

  it("returns an empty map and logs when yaml is malformed", () => {
    writeFileSync(groupsPath, "groups: [not: valid");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadGroups(groupsPath)).toEqual({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining("groups"));
  });

  it("returns an empty map when the schema is invalid", () => {
    writeFileSync(groupsPath, "groups:\n  exec: exec@example.com\n");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadGroups(groupsPath)).toEqual({});
  });
});

describe("clearance resolution", () => {
  const groups = {
    admins: ["admin@example.com"],
    exec: ["exec@example.com", "admin@example.com"],
    finance: ["exec@example.com"],
  };

  it("returns all memberships plus implicit all-hands in stable order", () => {
    expect(resolveClearance("exec@example.com", groups)).toEqual(["all-hands", "exec", "finance"]);
  });

  it("gives an unknown email only all-hands clearance", () => {
    expect(resolveClearance("unknown@example.com", groups)).toEqual(["all-hands"]);
  });

  it("recognizes admins", () => {
    expect(isAdmin("admin@example.com", groups, {})).toBe(true);
    expect(isAdmin("exec@example.com", groups, {})).toBe(false);
  });
});

describe("alias resolution is symmetric", () => {
  // groups.yaml can name a person by either of their addresses. Canonicalizing
  // only the requester made an alias mean two opposite things depending on the
  // column it sat in: it resolved to the person as a requester, and to nobody
  // as a member, so that membership granted the group to no one at all.
  const aliases = { "nick@work.test": "nick@personal.test" };

  it("grants a group that lists the alias to the person who owns it", () => {
    const groups = { product: ["nick@work.test"] };

    expect(resolveClearance("nick@personal.test", groups, aliases)).toEqual(["all-hands", "product"]);
    expect(resolveClearance("nick@work.test", groups, aliases)).toEqual(["all-hands", "product"]);
  });

  it("still grants nothing to someone the registry does not connect", () => {
    const groups = { product: ["nick@work.test"] };

    expect(resolveClearance("stranger@example.com", groups, aliases)).toEqual(["all-hands"]);
  });

  it("recognizes an admin listed under either address", () => {
    const groups = { admins: ["nick@work.test"] };

    expect(isAdmin("nick@personal.test", groups, aliases)).toBe(true);
    expect(isAdmin("stranger@example.com", groups, aliases)).toBe(false);
  });

  it("knows a member listed under either address", () => {
    // The picker offers the canonical address, so validation has to accept it
    // even when the file happens to list only the alias, or the only option a
    // picker offers is one the route rejects.
    const groups = { product: ["nick@work.test"] };

    expect(isKnownMember("nick@personal.test", groups, aliases)).toBe(true);
    expect(isKnownMember("nick@work.test", groups, aliases)).toBe(true);
    expect(isKnownMember("stranger@example.com", groups, aliases)).toBe(false);
  });
});

describe("canSee", () => {
  it("allows admins to see every visibility label", () => {
    expect(canSee(["unknown-group"], ["all-hands"], true)).toBe(true);
  });

  it("treats absent or empty visibility as all-hands", () => {
    expect(canSee(undefined, ["all-hands"], false)).toBe(true);
    expect(canSee([], ["all-hands"], false)).toBe(true);
  });

  it("uses union semantics and denies unknown groups to non-admins", () => {
    expect(canSee(["exec", "finance"], ["all-hands", "finance"], false)).toBe(true);
    expect(canSee(["exec"], ["all-hands"], false)).toBe(false);
    expect(canSee(["unknown-group"], ["all-hands", "exec"], false)).toBe(false);
  });
});

describe("member helpers", () => {
  const groups = { engineering: ["Alice@x.com", "bob@x.com"], research: ["carol@x.com", "bob@x.com"] };

  it("isKnownMember matches case-insensitively across all groups", () => {
    expect(isKnownMember("alice@x.com", groups)).toBe(true);
    expect(isKnownMember("CAROL@x.com", groups)).toBe(true);
    expect(isKnownMember("dave@x.com", groups)).toBe(false);
  });

  it("allMembers returns the unique lowercased sorted union", () => {
    expect(allMembers(groups)).toEqual(["alice@x.com", "bob@x.com", "carol@x.com"]);
  });
});

describe("assignableMembers", () => {
  // The live shape of this: one person listed under a canonical address in one
  // group and under an address aliases.yaml records as an alias of it in
  // another. Both rows usually resolve to the same display name, so a picker
  // built on allMembers offered two options nobody could tell apart.
  const groups = { product: ["nick@work.test"], admins: ["nick@personal.test", "bob@x.com"] };
  const aliases = { "nick@work.test": "nick@personal.test" };

  it("folds an alias onto the canonical address it resolves to", () => {
    expect(assignableMembers(groups, aliases)).toEqual(["bob@x.com", "nick@personal.test"]);
  });

  it("is allMembers when nothing on the roster is an alias", () => {
    expect(assignableMembers(groups, {})).toEqual(allMembers(groups));
  });

  it("leaves an alias alone when its canonical is not on the roster", () => {
    // Folding here would offer an address that is in no group at all, which
    // isKnownMember rejects on submit: an option that always fails is worse
    // than a duplicate.
    const orphan = { product: ["nick@work.test"] };

    expect(assignableMembers(orphan, aliases)).toEqual(["nick@work.test"]);
  });

  it("keeps two people who merely share a domain apart", () => {
    expect(assignableMembers({ team: ["a@x.com", "b@x.com"] }, {})).toEqual(["a@x.com", "b@x.com"]);
  });
});
