// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Share2 } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";

const isSharedDocsEnabledMock = vi.fn();
const isDocImportEnabledMock = vi.fn();
vi.mock("@/lib/shared-docs/config", () => ({
  isSharedDocsEnabled: () => isSharedDocsEnabledMock(),
  // Team sharing off, so this page's list resolves user share rows only and
  // these assertions describe the same byte-path they always did.
  isDocGroupSharingEnabled: () => false,
  isDocImportEnabled: () => isDocImportEnabledMock(),
}));

const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
// The page now carries the New document control, a client island that calls
// useRouter; the app router is not mounted under renderToStaticMarkup.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// Identity-only: the surface must use getIdentity, NOT resolveIdentity (which
// would pull in spec-19 clearance). Mocking resolveIdentity would silently pass
// even if the page regressed to it, so we mock getIdentity and assert on it.
const getIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({ getIdentity: () => getIdentityMock() }));
const resolveIdentitySpy = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({ resolveIdentity: () => resolveIdentitySpy() }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const listSharedByOwnerMock = vi.fn(() => []);
const listSharedWithMock = vi.fn(() => []);
vi.mock("@/lib/db/shared-docs", () => ({
  listSharedByOwner: () => listSharedByOwnerMock(),
  listSharedWith: () => listSharedWithMock(),
}));

const Page = (await import("./page")).default;

beforeEach(() => {
  isSharedDocsEnabledMock.mockReset();
  isDocImportEnabledMock.mockReset().mockReturnValue(false);
  getIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com" });
  resolveIdentitySpy.mockClear();
  listSharedByOwnerMock.mockClear();
  listSharedWithMock.mockClear();
});

describe("SharedDocsPage flag-off scaffold", () => {
  it("renders the byte-identical spec-18 RouteScaffold when the flag is off", async () => {
    isSharedDocsEnabledMock.mockReturnValue(false);
    const actual = renderToStaticMarkup(await Page());
    const expected = renderToStaticMarkup(
      <RouteScaffold
        icon={Share2}
        eyebrow="My Shared Docs"
        title="Shared with people"
        description="Documents you handed directly to specific teammates, outside the knowledge base. Open one to manage who can view, comment, or edit it."
        spec="spec 28"
        flag="SHARED_DOCS_ENABLED"
      />,
    );
    expect(actual).toBe(expected);
    // The off-branch must not read identity or the store at all.
    expect(getIdentityMock).not.toHaveBeenCalled();
    expect(listSharedByOwnerMock).not.toHaveBeenCalled();
    expect(listSharedWithMock).not.toHaveBeenCalled();
  });

  it("renders the real two-group list (not the scaffold) when the flag is on", async () => {
    isSharedDocsEnabledMock.mockReturnValue(true);
    const { container } = render(await Page());
    expect(container.textContent).not.toContain("not switched on here");
    expect(container.textContent).toContain("Shared by me");
    expect(container.textContent).toContain("Shared with me");
    expect(getIdentityMock).toHaveBeenCalled();
  });

  it("offers the Upload button and drop target only when import is on", async () => {
    isSharedDocsEnabledMock.mockReturnValue(true);
    const off = render(await Page());
    expect(off.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(off.queryByTestId("doc-drop-zone")).toBeNull();
    off.unmount();

    isDocImportEnabledMock.mockReturnValue(true);
    const on = render(await Page());
    expect(on.getByRole("button", { name: /Upload/ })).toBeInTheDocument();
    expect(on.getByTestId("doc-drop-zone")).toBeInTheDocument();
    expect(on.container.textContent).toContain("Shared by me");
  });

  it("resolves identity ONLY, never resolveIdentity (no KB clearance coupling, finding 5)", async () => {
    isSharedDocsEnabledMock.mockReturnValue(true);
    await Page();
    expect(getIdentityMock).toHaveBeenCalled();
    expect(resolveIdentitySpy).not.toHaveBeenCalled();
  });
});
