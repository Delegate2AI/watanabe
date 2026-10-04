import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/authority/roles` is deliberately NOT mocked: the whole point of the
 * actor is that its `can` is the real capability resolver, so the two surfaces
 * cannot disagree about what someone may do. Only the two inputs are pinned,
 * the roster here and the roles file below, so the test does not depend on the
 * developer's checkout.
 */
const GROUPS = { exec: ["alice@example.com"], eng: ["alice@example.com", "bob@example.com"] };
const loadGroupsMock = vi.fn(() => GROUPS);
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => loadGroupsMock() };
});

// A directory with no access/roles.yaml in it, so `loadRoles()` degrades to an
// empty map and `effectiveRole` sits at its viewer default for everybody.
vi.mock("@/lib/memory/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/config")>();
  return { ...actual, memoryWorktreeDir: () => path.join(os.tmpdir(), "service-actor-no-roles") };
});

const { actorFor, mcpActorFor } = await import("./actor");
const { invalidateRolesCache } = await import("@/lib/authority/roles");

beforeEach(() => {
  loadGroupsMock.mockClear();
  delete process.env.ROLES_ENABLED;
  delete process.env.BOOTSTRAP_ADMINS;
  invalidateRolesCache();
});

afterEach(() => {
  delete process.env.ROLES_ENABLED;
  delete process.env.BOOTSTRAP_ADMINS;
});

describe("actorFor", () => {
  it("normalizes the address, so every service compares against one form", () => {
    expect(actorFor("  Alice@Example.com ").email).toBe("alice@example.com");
  });

  it("resolves the clearance the rest of the app resolves, all-hands included", () => {
    expect(actorFor("alice@example.com").clearance.sort()).toEqual(["all-hands", "eng", "exec"]);
    expect(actorFor("bob@example.com").clearance.sort()).toEqual(["all-hands", "eng"]);
    expect(actorFor("stranger@example.com").clearance).toEqual(["all-hands"]);
  });

  // The roster travels with the actor because a request needs it twice: once to
  // resolve this person's clearance, and again to check that an assignee they
  // named is somebody. Reading groups.yaml a second time for the same request
  // would be a second uncached file read and could see a different file.
  it("carries the roster it resolved against, and reads it once", () => {
    const actor = actorFor("alice@example.com");

    expect(actor.groups).toBe(GROUPS);
    expect(loadGroupsMock).toHaveBeenCalledTimes(1);
  });

  it("does not read the roster at all when handed one", () => {
    const actor = actorFor("alice@example.com", GROUPS);

    expect(actor.groups).toBe(GROUPS);
    expect(loadGroupsMock).not.toHaveBeenCalled();
  });

  it("delegates to the real capability resolver with roles off", () => {
    const actor = actorFor("alice@example.com", GROUPS);

    expect(actor.can("write")).toBe(true);
    expect(actor.can("approve")).toBe(true);
    expect(actor.can("manageAccess")).toBe(false);
    expect(actor.can("triggerIngest")).toBe(false);
  });

  // This is the state stage and prod are actually in: ROLES_ENABLED is "1" and
  // anyone absent from roles.yaml resolves to viewer, which holds nothing.
  it("gives an unlisted address nothing at all with roles on", () => {
    process.env.ROLES_ENABLED = "1";
    const actor = actorFor("alice@example.com", GROUPS);

    expect(actor.can("write")).toBe(false);
    expect(actor.can("approve")).toBe(false);
    expect(actor.can("manageAccess")).toBe(false);
  });

  it("still honours the bootstrap admin floor, which is the break-glass path", () => {
    process.env.ROLES_ENABLED = "1";
    process.env.BOOTSTRAP_ADMINS = "alice@example.com";

    expect(actorFor("alice@example.com", GROUPS).can("manageAccess")).toBe(true);
  });
});

/**
 * The MCP surface's actor. Stage and prod run with ROLES_ENABLED on and almost
 * nobody listed in roles.yaml, so without a floor the workspace tools would be
 * invisible to the staff they exist for. The floor is exactly editor: write and
 * nothing else. It never reaches approve, manageAccess or triggerIngest, and the
 * knowledge-base write path deliberately checks the real `can` instead, so a
 * merge request into the vault still needs a real role.
 */
describe("mcpActorFor", () => {
  it("floors an unlisted member at editor, and no higher", () => {
    process.env.ROLES_ENABLED = "1";
    const actor = mcpActorFor("alice@example.com", GROUPS);

    expect(actor.can("write")).toBe(true);
    expect(actor.can("approve")).toBe(false);
    expect(actor.can("manageAccess")).toBe(false);
    expect(actor.can("triggerIngest")).toBe(false);
  });

  it("does not take anything away from someone who already holds more", () => {
    process.env.ROLES_ENABLED = "1";
    process.env.BOOTSTRAP_ADMINS = "alice@example.com";
    const actor = mcpActorFor("alice@example.com", GROUPS);

    expect(actor.can("approve")).toBe(true);
    expect(actor.can("manageAccess")).toBe(true);
  });

  it("resolves the same identity and clearance as the plain actor", () => {
    const plain = actorFor("  Alice@Example.com ", GROUPS);
    const mcp = mcpActorFor("  Alice@Example.com ", GROUPS);

    expect(mcp.email).toBe(plain.email);
    expect(mcp.clearance).toEqual(plain.clearance);
  });
});
