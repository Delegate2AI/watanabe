import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { loadAccess, writeAccess } from "./access";
import { can, effectiveRole, invalidateRolesCache, loadDefaultRole, loadRoles } from "./roles";

let root: string;
let rolesPath: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "authority-roles-default-"));
  mkdirSync(path.join(root, "access"));
  rolesPath = path.join(root, "access", "roles.yaml");
  delete process.env.BOOTSTRAP_ADMINS;
  process.env.ROLES_ENABLED = "1";
  invalidateRolesCache();
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("loadDefaultRole", () => {
  it("reads an editor default from the roles file", () => {
    writeFileSync(rolesPath, "roles:\n  admin: [admin@example.com]\ndefault: editor\n");

    expect(loadDefaultRole(rolesPath)).toBe("editor");
    expect(loadRoles(rolesPath)).toEqual({ admin: ["admin@example.com"] });
  });

  it("is viewer when the file is absent or says viewer", () => {
    expect(loadDefaultRole(rolesPath)).toBe("viewer");

    writeFileSync(rolesPath, "roles:\n  admin: [admin@example.com]\ndefault: viewer\n");
    expect(loadDefaultRole(rolesPath)).toBe("viewer");
  });

  it.each(["approver", "admin"])("refuses a %s default rather than handing it to every member", (role) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(rolesPath, `roles:\n  admin: [admin@example.com]\ndefault: ${role}\n`);

    expect(loadDefaultRole(rolesPath)).toBe("viewer");
    expect(error).toHaveBeenCalled();
  });
});

describe("an editor default", () => {
  const roles = { viewer: ["held-back@example.com"], admin: ["admin@example.com"] };

  it("makes an unlisted member an editor who can write", () => {
    expect(effectiveRole("unlisted@example.com", roles, {}, "editor")).toBe("editor");
    expect(can("unlisted@example.com", "write", roles, "editor")).toBe(true);
    expect(can("unlisted@example.com", "approve", roles, "editor")).toBe(false);
  });

  it("keeps an explicitly listed viewer a viewer", () => {
    expect(effectiveRole("held-back@example.com", roles, {}, "editor")).toBe("viewer");
    expect(can("held-back@example.com", "write", roles, "editor")).toBe(false);
  });

  it("is what an unlisted member gets from the live file with no explicit fallback", () => {
    writeFileSync(rolesPath, "roles:\n  admin: [admin@example.com]\ndefault: editor\n");

    expect(effectiveRole("unlisted@example.com", loadRoles(rolesPath), {}, loadDefaultRole(rolesPath))).toBe("editor");
  });
});

describe("access administration with an editor default", () => {
  beforeEach(() => {
    process.env.AUTHORITY_ENABLED = "1";
    writeFileSync(path.join(root, "access", "groups.yaml"), "groups:\n  exec: [member@example.com]\n");
    writeFileSync(rolesPath, "roles:\n  admin: [admin@example.com]\ndefault: editor\n");
    commitPrivateAccessMock.mockReset().mockImplementation(async (mutation: () => Record<string, string> | { error: string }) => {
      const files = mutation();
      if ("error" in files) return { ok: false, error: files.error };
      for (const [relative, content] of Object.entries(files)) writeFileSync(path.join(root, relative), content);
      return { ok: true };
    });
  });

  it("loads the default the file declares", () => {
    expect(loadAccess(root).default).toBe("editor");
  });

  it("keeps the default when an admin changes a role", async () => {
    const result = await writeAccess(
      { verb: "setRole", email: "member@example.com", role: "viewer" },
      "admin@example.com",
      { root, vaultRoot: root },
    );

    expect(result.ok).toBe(true);
    expect(readFileSync(rolesPath, "utf8")).toContain("default: editor");
    expect(loadAccess(root).roles.viewer).toEqual(["member@example.com"]);
  });
});
