import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { loadAccess, writeAccess } from "./access";

function seedAccess(root: string): void {
  mkdirSync(path.join(root, "access"), { recursive: true });
  writeFileSync(
    path.join(root, "access", "groups.yaml"),
    "groups:\n  exec: [member@example.com]\n  all-hands: []\n",
  );
  writeFileSync(
    path.join(root, "access", "roles.yaml"),
    "roles:\n  admin: [admin@example.com]\n  editor: [member@example.com]\ndefault: viewer\n",
  );
}

describe("loadAccess", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "authority-access-"));
    mkdirSync(path.join(root, "access"));
    process.env.AUTHORITY_ENABLED = "1";
    process.env.ROLES_ENABLED = "1";
    process.env.BOOTSTRAP_ADMINS = "admin@example.com";
    commitPrivateAccessMock.mockReset().mockImplementation(
      async (files: Record<string, string>) => {
        for (const [relative, content] of Object.entries(files)) {
          writeFileSync(path.join(root, relative), content);
        }
        return { ok: true };
      },
    );
  });

  afterEach(() => {
    delete process.env.AUTHORITY_ENABLED;
    delete process.env.ROLES_ENABLED;
    delete process.env.BOOTSTRAP_ADMINS;
    rmSync(root, { recursive: true, force: true });
  });

  it("loads normalized groups and roles from the private access directory", () => {
    writeFileSync(
      path.join(root, "access", "groups.yaml"),
      "groups:\n  exec: [ALICE@example.com]\n  all-hands: []\n",
    );
    writeFileSync(
      path.join(root, "access", "roles.yaml"),
      "roles:\n  admin: [ADMIN@example.com]\n  editor: [alice@example.com]\ndefault: viewer\n",
    );

    expect(loadAccess(root)).toEqual({
      groups: { exec: ["alice@example.com"], "all-hands": [] },
      roles: { admin: ["admin@example.com"], editor: ["alice@example.com"] },
      flags: {},
      default: "viewer",
    });
  });
});

describe("writeAccess", () => {
  let root: string;
  let vaultRoot: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "authority-access-write-"));
    vaultRoot = path.join(root, "vault");
    mkdirSync(vaultRoot);
    seedAccess(root);
    process.env.AUTHORITY_ENABLED = "1";
    process.env.ROLES_ENABLED = "1";
    process.env.BOOTSTRAP_ADMINS = "admin@example.com";
    commitPrivateAccessMock.mockReset().mockImplementation(
      async (files: Record<string, string>) => {
        for (const [relative, content] of Object.entries(files)) {
          writeFileSync(path.join(root, relative), content);
        }
        return { ok: true };
      },
    );
  });

  afterEach(() => {
    delete process.env.AUTHORITY_ENABLED;
    delete process.env.ROLES_ENABLED;
    delete process.env.BOOTSTRAP_ADMINS;
    rmSync(root, { recursive: true, force: true });
  });

  it("applies the closed change verbs and commits them as the actor", async () => {
    await writeAccess({ verb: "addToGroup", group: "exec", email: "NEW@example.com" }, "admin@example.com", { root, vaultRoot });
    await writeAccess({ verb: "removeFromGroup", group: "exec", email: "member@example.com" }, "admin@example.com", { root, vaultRoot });
    await writeAccess({ verb: "createGroup", group: "finance" }, "admin@example.com", { root, vaultRoot });
    await writeAccess({ verb: "deleteGroup", group: "all-hands" }, "admin@example.com", { root, vaultRoot });
    const result = await writeAccess({ verb: "setRole", email: "NEW@example.com", role: "approver" }, "admin@example.com", { root, vaultRoot });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.version).toMatch(/^[a-f0-9]{64}$/);
    expect(loadAccess(root)).toEqual({
      groups: { exec: ["new@example.com"], finance: [] },
      roles: { admin: ["admin@example.com"], editor: ["member@example.com"], approver: ["new@example.com"] },
      flags: {},
      default: "viewer",
    });
    expect(commitPrivateAccessMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ authorEmail: "admin@example.com" }),
    );
  });

  it("refuses invalid changes and never commits them", async () => {
    expect((await writeAccess({ verb: "addToGroup", group: "exec", email: "bad" }, "admin@example.com", { root, vaultRoot })).ok).toBe(false);
    expect((await writeAccess({ verb: "createGroup", group: " " }, "admin@example.com", { root, vaultRoot })).ok).toBe(false);
    process.env.BOOTSTRAP_ADMINS = "";
    expect((await writeAccess({ verb: "setRole", email: "admin@example.com", role: "viewer" }, "admin@example.com", { root, vaultRoot })).ok).toBe(false);
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("denies non-admins before resolving targets", async () => {
    const existing = await writeAccess({ verb: "deleteGroup", group: "exec" }, "member@example.com", { root, vaultRoot });
    const absent = await writeAccess({ verb: "deleteGroup", group: "secret" }, "member@example.com", { root, vaultRoot });

    expect(existing).toEqual(absent);
    expect(existing).toEqual({ ok: false, error: "forbidden" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("warns when deleting a group referenced by note visibility", async () => {
    writeFileSync(path.join(vaultRoot, "meeting.md"), "---\nvisibility: [exec]\n---\n# Meeting\n");

    const result = await writeAccess({ verb: "deleteGroup", group: "exec" }, "admin@example.com", { root, vaultRoot });

    expect(result.warnings).toEqual(["Group exec is referenced by 1 note."]);
  });

  it("sets a known flag and commits all three access files", async () => {
    const result = await writeAccess(
      { verb: "setFlag", name: "MEMORY_ENABLED", value: false },
      "admin@example.com",
      { root, vaultRoot },
    );

    expect(result.ok).toBe(true);
    expect(loadAccess(root).flags).toEqual({ MEMORY_ENABLED: false });
    expect(readFileSync(path.join(root, "access", "flags.yaml"), "utf8")).toContain(
      "MEMORY_ENABLED: false",
    );
    expect(commitPrivateAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        "access/groups.yaml": expect.any(String),
        "access/roles.yaml": expect.any(String),
        "access/flags.yaml": expect.any(String),
      }),
      expect.objectContaining({ authorEmail: "admin@example.com" }),
    );
  });

  it("refuses an unknown flag before committing", async () => {
    const result = await writeAccess(
      { verb: "setFlag", name: "UNKNOWN_ENABLED", value: true },
      "admin@example.com",
      { root, vaultRoot },
    );

    expect(result).toEqual({ ok: false, error: "unknown flag" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("names the flag and its new value in the commit subject", async () => {
    await writeAccess(
      { verb: "setFlag", name: "PACKAGES_ENABLED", value: true },
      "admin@example.com",
      { root, vaultRoot },
    );

    expect(commitPrivateAccessMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ message: "chore(access): set flag PACKAGES_ENABLED=on" }),
    );

    await writeAccess(
      { verb: "setFlag", name: "PACKAGES_ENABLED", value: false },
      "admin@example.com",
      { root, vaultRoot },
    );

    expect(commitPrivateAccessMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ message: "chore(access): set flag PACKAGES_ENABLED=off" }),
    );
  });

  it("names the subject of every other access verb in its commit subject", async () => {
    const subjects: string[] = [];
    for (const change of [
      { verb: "addToGroup", group: " exec ", email: "MARIA.CHEN@example.com" },
      { verb: "removeFromGroup", group: "exec", email: "member@example.com" },
      { verb: "createGroup", group: "research" },
      { verb: "setRole", email: "devon.brooks@example.com", role: "approver" },
      { verb: "deleteGroup", group: "research" },
    ] as const) {
      await writeAccess(change, "admin@example.com", { root, vaultRoot });
      subjects.push(commitPrivateAccessMock.mock.lastCall?.[1].message as string);
    }

    expect(subjects).toEqual([
      "chore(access): add maria.chen@example.com to exec",
      "chore(access): remove member@example.com from exec",
      "chore(access): create group research",
      "chore(access): set role for devon.brooks@example.com to approver",
      "chore(access): delete group research",
    ]);
  });
});
