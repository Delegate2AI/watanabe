// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { IdentityProvider } from "@/components/identity-provider";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
const resolveIdentityMock = vi.fn();
const canMock = vi.fn();
const loadAccessMock = vi.fn();
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock(), useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args) }));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
  isRolesEnabled: () => true,
  isBootstrapAdmin: () => false,
  ROLE_NAMES: ["viewer", "editor", "approver", "admin"],
}));
const aliasAdminEnabledMock = vi.fn(() => true);
const loadAliasMapMock = vi.fn(() => ({}) as Record<string, string[]>);
vi.mock("@/lib/authority/config", () => ({
  isAuthorityEnabled: () => true,
  isAliasAdminEnabled: () => aliasAdminEnabledMock(),
}));
vi.mock("@/lib/authority/aliases-store", () => ({ loadAliasMap: () => loadAliasMapMock() }));
vi.mock("@/lib/authority/access", () => ({
  loadAccess: () => loadAccessMock(),
  loadAccessHistory: async () => [],
}));

import Page from "./page";

beforeEach(() => {
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "admin@example.com" });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({
    groups: { exec: ["member@example.com"] },
    roles: { admin: ["admin@example.com"] },
    flags: {},
    default: "viewer",
  });
  notFoundMock.mockClear();
  aliasAdminEnabledMock.mockReset().mockReturnValue(true);
  loadAliasMapMock.mockReset().mockReturnValue({});
});

describe("AccessAdminPage", () => {
  it("renders access controls for an admin", async () => {
    const { container } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"] }}>
        {await Page()}
      </IdentityProvider>,
    );

    expect(container.textContent).toContain("Access administration");
    expect(container.textContent).toContain("member@example.com");
  });

  it("surfaces the viewer's role when it is present on the identity (spec 22)", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "admin@example.com", role: "admin" });
    const { getByTestId } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"], role: "admin" }}>
        {await Page()}
      </IdentityProvider>,
    );
    const line = getByTestId("signed-in-as");
    expect(line.textContent).toContain("admin@example.com");
    expect(getByTestId("viewer-role").textContent).toBe("admin");
  });

  it("names the signed-in person once, in the tab bar and nowhere else", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "admin@example.com", role: "admin" });
    const { container, getAllByTestId } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"], role: "admin" }}>
        {await Page()}
      </IdentityProvider>,
    );

    expect(getAllByTestId("signed-in-as")).toHaveLength(1);
    expect(container.textContent?.match(/Signed in as/g) ?? []).toHaveLength(1);
  });

  it("omits the role from the signed-in line when the identity carries no role (ROLES_ENABLED off)", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "admin@example.com" });
    const { getByTestId, queryByTestId } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"] }}>
        {await Page()}
      </IdentityProvider>,
    );
    expect(queryByTestId("viewer-role")).toBeNull();
    expect(getByTestId("signed-in-as").textContent).toContain("admin@example.com");
  });

  it("offers the alias panel and its count on each member row", async () => {
    loadAliasMapMock.mockReturnValue({ "member@example.com": ["member.personal@example.test"] });
    const { getByRole } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"] }}>
        {await Page()}
      </IdentityProvider>,
    );

    expect(getByRole("button", { name: "Aliases (1)" })).toBeInTheDocument();
  });

  it("does not read or ship a single alias address while the flag is off", async () => {
    aliasAdminEnabledMock.mockReturnValue(false);
    const { container, queryByRole } = render(
      <IdentityProvider identity={{ email: "admin@example.com", name: "Admin", initials: "A", clearance: ["admins"] }}>
        {await Page()}
      </IdentityProvider>,
    );

    expect(queryByRole("button", { name: /Aliases/ })).toBeNull();
    expect(loadAliasMapMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("example.test");
  });

  it("returns the identical 404 for a non-admin or missing identity", async () => {
    canMock.mockReturnValue(false);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    resolveIdentityMock.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadAccessMock).not.toHaveBeenCalled();
  });
});
