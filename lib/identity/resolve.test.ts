import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadPeopleMock = vi.fn(() => ({}));
const upsertPersonMock = vi.fn<() => Promise<void>>();
vi.mock("@/lib/people/store", () => ({
  loadPeople: (...args: unknown[]) => loadPeopleMock(...(args as [])),
  upsertPerson: (...args: unknown[]) => upsertPersonMock(...(args as [])),
}));

import { __resetPeopleSignInForTests } from "@/lib/people/sign-in";
import { resolveClearanceForEmail, resolveIdentity } from "./resolve";

describe("authority identity resolution", () => {
  let memoryRoot: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    memoryRoot = mkdtempSync(path.join(os.tmpdir(), "authority-identity-"));
    mkdirSync(path.join(memoryRoot, "access"), { recursive: true });
    writeFileSync(
      path.join(memoryRoot, "access", "groups.yaml"),
      "groups:\n  admins: [admin@example.com]\n  exec: [exec@example.com, admin@example.com]\n",
    );
    writeFileSync(
      path.join(memoryRoot, "access", "roles.yaml"),
      "roles:\n  editor: [exec@example.com]\ndefault: viewer\n",
    );
    process.env.MEMORY_CHECKOUT_DIR = memoryRoot;
    delete process.env.PORTAL_PROXY_ASSERT_SECRET;
    loadPeopleMock.mockReset().mockReturnValue({});
    upsertPersonMock.mockReset().mockResolvedValue(undefined);
    __resetPeopleSignInForTests();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  it("returns only all-hands when authority is disabled", async () => {
    delete process.env.AUTHORITY_ENABLED;
    const identity = await resolveIdentity(
      new Headers({ "X-Auth-Request-Email": "exec@example.com", "X-Auth-Request-User": "Exec User" }),
    );
    expect(identity).toEqual({
      email: "exec@example.com",
      name: "Exec User",
      clearance: ["all-hands"],
    });
  });

  it("adds resolved groups when authority is enabled", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    const identity = await resolveIdentity(
      new Headers({ "X-Auth-Request-Email": "exec@example.com", "X-Auth-Request-User": "Exec User" }),
    );
    expect(identity?.clearance).toEqual(["all-hands", "exec"]);
  });

  it("adds the effective role only when roles are enabled", async () => {
    process.env.ROLES_ENABLED = "1";
    const identity = await resolveIdentity(
      new Headers({ "X-Auth-Request-Email": "exec@example.com", "X-Auth-Request-User": "Exec User" }),
    );
    expect(identity?.role).toBe("editor");
  });

  it("fails closed for unknown users and malformed groups", () => {
    process.env.AUTHORITY_ENABLED = "1";
    expect(resolveClearanceForEmail("unknown@example.com")).toEqual(["all-hands"]);
    writeFileSync(path.join(memoryRoot, "access", "groups.yaml"), "groups: [broken");
    expect(resolveClearanceForEmail("admin@example.com")).toEqual(["all-hands"]);
  });

  it("returns null when the proxy identity is absent", async () => {
    expect(await resolveIdentity(new Headers())).toBeNull();
  });
});

describe("people directory self-population", () => {
  let memoryRoot: string;
  const savedEnv = { ...process.env };
  const headers = new Headers({
    "X-Auth-Request-Email": "exec@example.com",
    "X-Auth-Request-User": "Exec User",
  });

  beforeEach(() => {
    memoryRoot = mkdtempSync(path.join(os.tmpdir(), "people-identity-"));
    mkdirSync(path.join(memoryRoot, "access"), { recursive: true });
    process.env.MEMORY_CHECKOUT_DIR = memoryRoot;
    delete process.env.PORTAL_PROXY_ASSERT_SECRET;
    loadPeopleMock.mockReset().mockReturnValue({});
    upsertPersonMock.mockReset().mockResolvedValue(undefined);
    __resetPeopleSignInForTests();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(memoryRoot, { recursive: true, force: true });
  });

  it("writes nothing and returns the same identity when the flag is off", async () => {
    delete process.env.PEOPLE_ENABLED;

    expect(await resolveIdentity(headers)).toEqual({
      email: "exec@example.com",
      name: "Exec User",
      clearance: ["all-hands"],
    });
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("records the header name without changing the resolved identity", async () => {
    process.env.PEOPLE_ENABLED = "1";

    expect(await resolveIdentity(headers)).toEqual({
      email: "exec@example.com",
      name: "Exec User",
      clearance: ["all-hands"],
    });
    await vi.waitFor(() => expect(upsertPersonMock).toHaveBeenCalledWith("exec@example.com", {
      name: "Exec User",
      source: "idp",
    }));
  });

  it("resolves normally when the directory write rejects", async () => {
    process.env.PEOPLE_ENABLED = "1";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertPersonMock.mockRejectedValue(new Error("commit refused"));

    await expect(resolveIdentity(headers)).resolves.toEqual({
      email: "exec@example.com",
      name: "Exec User",
      clearance: ["all-hands"],
    });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });
});
