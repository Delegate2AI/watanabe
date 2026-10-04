import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// notFound() throws a sentinel we can assert on, mirroring Next's control flow.
class NotFoundError extends Error {}
const notFoundMock = vi.fn(() => {
  throw new NotFoundError("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args),
}));

const vaultRootForMock = vi.fn((clearance: string[]) => `/vault/${clearance.join("+")}`);
vi.mock("@/lib/repo", () => ({
  vaultRootFor: (clearance: string[]) => vaultRootForMock(clearance),
  unfilteredVaultRoot: () => "/unfiltered",
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const flagMock = vi.fn();
vi.mock("@/lib/config/flags", () => ({ isFlagEnabled: (...args: unknown[]) => flagMock(...args) }));

const { requesterVaultRoot, selectKbRoots } = await import("./request");

beforeEach(() => {
  resolveIdentityMock.mockReset();
  notFoundMock.mockClear();
  vaultRootForMock.mockClear();
  canMock.mockReset();
  flagMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  delete process.env.AUTHORITY_ENABLED;
});

describe("requesterVaultRoot (KB view security seam)", () => {
  it("fails closed with notFound() when there is no identity, authority off", async () => {
    delete process.env.AUTHORITY_ENABLED;
    resolveIdentityMock.mockResolvedValue(null);
    await expect(requesterVaultRoot()).rejects.toBeInstanceOf(NotFoundError);
    expect(notFoundMock).toHaveBeenCalledOnce();
    // Critical: a missing identity must never reach vaultRootFor with all-hands.
    expect(vaultRootForMock).not.toHaveBeenCalled();
  });

  it("fails closed with notFound() when there is no identity, authority on", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    resolveIdentityMock.mockResolvedValue(null);
    await expect(requesterVaultRoot()).rejects.toBeInstanceOf(NotFoundError);
    expect(vaultRootForMock).not.toHaveBeenCalled();
  });

  it("returns the clearance-scoped root for an authenticated identity", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "x@example.com", clearance: ["all-hands", "exec"] });
    const { clearance, root } = await requesterVaultRoot();
    expect(clearance).toEqual(["all-hands", "exec"]);
    expect(vaultRootForMock).toHaveBeenCalledWith(["all-hands", "exec"]);
    expect(root).toBe("/vault/all-hands+exec");
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

describe("selectKbRoots", () => {
  it("gives an admin the unfiltered tree but keeps reads clearance-scoped", () => {
    canMock.mockReturnValue(true);
    const r = selectKbRoots({ clearance: ["all-hands"], email: "a@x", manageRequested: true });
    expect(r.treeRoot).toBe("/unfiltered");
    expect(r.readRoot).toBe("/vault/all-hands");
    expect(r.manage).toBe(true);
  });

  it("never switches the tree root for a non-admin", () => {
    canMock.mockReturnValue(false);
    const r = selectKbRoots({ clearance: ["all-hands"], email: "b@x", manageRequested: true });
    expect(r.treeRoot).toBe("/vault/all-hands");
    expect(r.manage).toBe(false);
  });

  it("does not manage when the flag is off, even for an admin", () => {
    canMock.mockReturnValue(true);
    flagMock.mockReturnValue(false);
    const r = selectKbRoots({ clearance: ["all-hands"], email: "a@x", manageRequested: true });
    expect(r.treeRoot).toBe("/vault/all-hands");
    expect(r.manage).toBe(false);
  });

  it("with the flag off, an admin is not treated as admin at all (flag-off byte-identical invariant)", () => {
    canMock.mockReturnValue(true);
    flagMock.mockReturnValue(false);
    const r = selectKbRoots({ clearance: ["all-hands"], email: "a@x", manageRequested: true });
    expect(r.isAdmin).toBe(false);
    expect(r.manage).toBe(false);
    expect(r.treeRoot).toBe(r.readRoot);
  });
});
