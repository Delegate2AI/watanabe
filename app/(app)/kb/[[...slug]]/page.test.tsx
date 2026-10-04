import { beforeEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: vi.fn(),
}));

const requesterKbRootsMock = vi.fn();
vi.mock("@/lib/kb/request", () => ({
  requesterKbRoots: (...args: unknown[]) => requesterKbRootsMock(...args),
}));

const resolveKbDocMock = vi.fn();
vi.mock("@/lib/kb/resolve", () => ({
  resolveKbDoc: (...args: unknown[]) => resolveKbDocMock(...args),
}));

const buildKbTreeMock = vi.fn<(root: string) => unknown[]>(() => []);
vi.mock("@/lib/kb/tree", () => ({ buildKbTree: (root: string) => buildKbTreeMock(root) }));
vi.mock("@/lib/kb/files", () => ({ buildWikilinkResolver: () => () => null }));
vi.mock("@/lib/kb/assets", () => ({ buildKbAssetResolver: () => () => null }));
vi.mock("@/lib/kb/backlinks", () => ({ backlinksFor: () => [] }));
vi.mock("@/lib/vault", () => ({
  resolveVaultEntry: () => null,
  readVaultFile: () => null,
}));
vi.mock("@/lib/authority/groups", () => ({ loadGroups: () => ({ exec: [] }) }));
vi.mock("@/components/kb/kb-layout", () => ({
  KbLayout: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/kb/doc-view", () => ({ DocView: () => null }));
vi.mock("@/components/kb/search-box", () => ({ SearchBox: () => null }));

const Page = (await import("./page")).default;

const note = {
  title: "Risk Tier Model",
  visibility: "all-hands" as const,
  body: "# Risk Tier Model",
};

function call() {
  return Page({
    params: Promise.resolve({ slug: ["03-product", "risk-tiers"] }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  notFoundMock.mockClear();
  requesterKbRootsMock.mockReset().mockResolvedValue({
    treeRoot: "/vault/cleared",
    readRoot: "/vault/cleared",
    email: "alice@example.com",
    clearance: ["all-hands"],
    isAdmin: false,
    manage: false,
  });
  resolveKbDocMock.mockReset().mockReturnValue({
    kind: "file",
    relPath: "03-product/risk-tiers.md",
    note,
  });
});

describe("KB deep-link clearance", () => {
  it("resolves the copied deep link through the requester's cleared root", async () => {
    await expect(call()).resolves.toBeTruthy();
    expect(resolveKbDocMock).toHaveBeenCalledWith(
      ["03-product", "risk-tiers"],
      "/vault/cleared",
    );
  });

  // Absent from the projection and never existed must both 404, and it must be a
  // REAL 404: returning a pane from the page would send HTTP 200 and every link
  // checker, cache and monitor would record a broken KB URL as healthy. The
  // reader still is not stranded, because `not-found.tsx` renders the tree.
  it("404s for an uncleared projection, exactly as for a slug that never existed", async () => {
    requesterKbRootsMock.mockResolvedValue({
      treeRoot: "/vault/uncleared",
      readRoot: "/vault/uncleared",
      email: "bob@example.com",
      clearance: ["all-hands"],
      isAdmin: false,
      manage: false,
    });
    resolveKbDocMock.mockReturnValue(null);

    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(resolveKbDocMock).toHaveBeenCalledWith(
      ["03-product", "risk-tiers"],
      "/vault/uncleared",
    );
  });
});
