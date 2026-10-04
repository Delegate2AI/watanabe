import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { can, effectiveRole, invalidateRolesCache, isRolesEnabled, loadRoles } from "./roles";
import { getConfig } from "@/lib/config";

let root: string;
let rolesPath: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "authority-roles-"));
  rolesPath = path.join(root, "roles.yaml");
  delete process.env.ROLES_ENABLED;
  delete process.env.BOOTSTRAP_ADMINS;
  invalidateRolesCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("isRolesEnabled", () => {
  it("defaults off and enables only for 1", () => {
    expect(isRolesEnabled()).toBe(false);
    process.env.ROLES_ENABLED = "0";
    expect(isRolesEnabled()).toBe(false);
    process.env.ROLES_ENABLED = "1";
    expect(isRolesEnabled()).toBe(true);
  });
});

describe("loadRoles", () => {
  it("parses and normalizes a valid roles file", () => {
    writeFileSync(
      rolesPath,
      "roles:\n  admin: [ADMIN@example.com]\n  approver: [approver@example.com]\n  editor: [Editor@example.com]\ndefault: viewer\n",
    );

    expect(loadRoles(rolesPath)).toEqual({
      admin: ["admin@example.com"],
      approver: ["approver@example.com"],
      editor: ["editor@example.com"],
    });
  });

  it("returns an empty map and logs when malformed", () => {
    writeFileSync(rolesPath, "roles: [broken");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(loadRoles(rolesPath)).toEqual({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining("roles"));
  });
});

// `can()` defaults its `roles` argument to `loadRoles()`, so before this cache
// every capability check was a file read, a YAML parse and a zod validation.
// PATCH /api/tasks/[id] does two per request and every MCP tool call does one.
// Stamped against the file's identity rather than held for the process's life,
// exactly as `aliasIndex` and `cachedFlagOverrides` are, because the worktree
// is a git checkout and something else can move the file underneath us.
describe("loadRoles caching", () => {
  // Two role files of identical byte length, so restoring the mtime leaves the
  // stamp genuinely unchanged and the only thing that could produce the fresh
  // answer is a re-read.
  const FIRST = "roles:\n  admin: [aaa@example.com]\ndefault: viewer\n";
  const SECOND = "roles:\n  admin: [bbb@example.com]\ndefault: viewer\n";

  // Times are pinned to an exact integer second rather than captured and
  // restored: the mtime this filesystem records has sub-millisecond precision,
  // and round-tripping it through a Date loses enough of it to move the stamp.
  const PINNED = 1_600_000_000;

  it("does not re-read while the file's stamp is unchanged", () => {
    writeFileSync(rolesPath, FIRST);
    utimesSync(rolesPath, PINNED, PINNED);
    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });

    writeFileSync(rolesPath, SECOND);
    utimesSync(rolesPath, PINNED, PINNED);
    expect(statSync(rolesPath).mtimeMs).toBe(PINNED * 1000);

    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });
  });

  it("picks the file up again once its stamp moves", () => {
    writeFileSync(rolesPath, FIRST);
    utimesSync(rolesPath, PINNED, PINNED);
    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });

    writeFileSync(rolesPath, SECOND);
    utimesSync(rolesPath, PINNED + 10, PINNED + 10);

    expect(loadRoles(rolesPath)).toEqual({ admin: ["bbb@example.com"] });
  });

  it("re-reads after an explicit invalidation, which is what a committed change calls", () => {
    writeFileSync(rolesPath, FIRST);
    utimesSync(rolesPath, PINNED, PINNED);
    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });

    writeFileSync(rolesPath, SECOND);
    utimesSync(rolesPath, PINNED, PINNED);
    invalidateRolesCache();

    expect(loadRoles(rolesPath)).toEqual({ admin: ["bbb@example.com"] });
  });

  it("caches per path, so one file's stamp cannot answer for another", () => {
    const other = path.join(root, "other.yaml");
    writeFileSync(rolesPath, FIRST);
    writeFileSync(other, SECOND);

    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });
    expect(loadRoles(other)).toEqual({ admin: ["bbb@example.com"] });
    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });
  });

  it("drops the cache when the file goes away, and keeps degrading to an empty map", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(rolesPath, FIRST);
    expect(loadRoles(rolesPath)).toEqual({ admin: ["aaa@example.com"] });

    rmSync(rolesPath);

    expect(loadRoles(rolesPath)).toEqual({});
    expect(error).not.toHaveBeenCalled();
  });
});

describe("effectiveRole", () => {
  const roles = {
    viewer: ["listed-viewer@example.com", "multi@example.com"],
    editor: ["editor@example.com", "multi@example.com"],
    approver: ["approver@example.com", "multi@example.com"],
    admin: ["admin@example.com", "multi@example.com"],
  };

  it.each([
    ["admin@example.com", "admin"],
    ["approver@example.com", "approver"],
    ["editor@example.com", "editor"],
    ["listed-viewer@example.com", "viewer"],
    ["unknown@example.com", "viewer"],
  ] as const)("resolves %s to %s", (email, expected) => {
    expect(effectiveRole(email, roles)).toBe(expected);
  });

  it("uses the highest role when an identity is listed more than once", () => {
    expect(effectiveRole("MULTI@example.com", roles)).toBe("admin");
  });

  it("keeps environment bootstrap admins at the admin floor", () => {
    process.env.BOOTSTRAP_ADMINS = " first@example.com,RECOVERY@example.com ";

    expect(effectiveRole("first@example.com", {})).toBe("admin");
    expect(effectiveRole("recovery@example.com", { viewer: ["recovery@example.com"] })).toBe("admin");
    expect(effectiveRole("other@example.com", {})).toBe("viewer");
  });

  // resolveClearance has always resolved the requester through the alias
  // registry. This did not, so a session signed in under an alias carried its
  // owner's groups while dropping to viewer: the two halves of authority
  // disagreed about who the person was. Invisible from the inside, because a
  // viewer still sees content and only loses controls that stop rendering.
  it("resolves a role through the alias registry, as clearance already did", () => {
    const aliases = { "nick@work.test": "nick@personal.test" };

    expect(effectiveRole("nick@work.test", { admin: ["nick@personal.test"] }, aliases)).toBe("admin");
    expect(effectiveRole("nick@personal.test", { admin: ["nick@work.test"] }, aliases)).toBe("admin");
  });

  it("grants nothing to an address the registry does not connect", () => {
    const aliases = { "nick@work.test": "nick@personal.test" };

    expect(effectiveRole("stranger@example.com", { admin: ["nick@personal.test"] }, aliases)).toBe("viewer");
  });
});

describe("can", () => {
  const roles = {
    viewer: ["viewer@example.com"],
    editor: ["editor@example.com"],
    approver: ["approver@example.com"],
    admin: ["admin@example.com"],
  };

  it.each([
    ["viewer@example.com", false, false, false, false],
    ["editor@example.com", true, false, false, false],
    ["approver@example.com", true, true, false, false],
    ["admin@example.com", true, true, true, true],
  ] as const)(
    "applies the capability matrix for %s",
    (email, write, approve, manageAccess, triggerIngest) => {
      process.env.ROLES_ENABLED = "1";
      expect(can(email, "write", roles)).toBe(write);
      expect(can(email, "approve", roles)).toBe(approve);
      expect(can(email, "manageAccess", roles)).toBe(manageAccess);
      expect(can(email, "triggerIngest", roles)).toBe(triggerIngest);
    },
  );

  it("preserves existing write and direct-mode behavior when roles are off", () => {
    delete process.env.ROLES_ENABLED;
    expect(can("viewer@example.com", "write", roles)).toBe(true);
    expect(can("viewer@example.com", "approve", roles)).toBe(true);
    expect(can("viewer@example.com", "manageAccess", roles)).toBe(false);
    expect(can("viewer@example.com", "triggerIngest", roles)).toBe(false);
  });

  it("treats the portal bot as admin with either flag state", () => {
    for (const enabled of ["0", "1"]) {
      process.env.ROLES_ENABLED = enabled;
      expect(can(getConfig().git.botEmail, "manageAccess", {})).toBe(true);
      expect(can(getConfig().git.botEmail, "triggerIngest", {})).toBe(true);
    }
  });

  it("does not grant admin to the bare portal-bot string, only the full committer email", () => {
    // Identities arrive as real IdP emails; only the exact bot committer address
    // is the implicit admin. A bare "portal-bot" must resolve as an ordinary
    // (unknown) identity, i.e. viewer, so the magic string cannot widen access.
    process.env.ROLES_ENABLED = "1";
    expect(can("portal-bot", "manageAccess", {})).toBe(false);
    expect(can("portal-bot", "write", {})).toBe(false);
  });

  it("allows only listed bootstrap admins to manage access with either flag state", () => {
    process.env.BOOTSTRAP_ADMINS = "recovery@example.com";

    for (const enabled of ["0", "1"]) {
      process.env.ROLES_ENABLED = enabled;
      expect(can("recovery@example.com", "manageAccess", {})).toBe(true);
      expect(can("unlisted@example.com", "manageAccess", {})).toBe(false);
    }
  });
});
