import { describe, it, expect, vi, beforeEach } from "vitest";

const requesterKbRootsMock = vi.fn();
vi.mock("@/lib/kb/request", () => ({
  requesterKbRoots: (...args: unknown[]) => requesterKbRootsMock(...args),
}));

const buildKbTreeMock = vi.fn<(root: string) => unknown[]>(() => []);
vi.mock("@/lib/kb/tree", () => ({ buildKbTree: (root: string) => buildKbTreeMock(root) }));
vi.mock("@/lib/authority/groups", () => ({ loadGroups: () => ({ exec: [], eng: [] }) }));
vi.mock("@/components/kb/kb-layout", () => ({
  KbLayout: (props: Record<string, unknown>) => ({ type: "KbLayout", props }),
}));
vi.mock("@/components/kb/search-box", () => ({ SearchBox: () => ({ type: "SearchBox" }) }));

const { default: KbNotFound } = await import("./not-found");

beforeEach(() => {
  buildKbTreeMock.mockClear();
  requesterKbRootsMock.mockReset().mockResolvedValue({
    treeRoot: "/vault/cleared",
    readRoot: "/vault/cleared",
    email: "bob@example.com",
    clearance: ["all-hands"],
    isAdmin: false,
  });
});

/**
 * The KB not-found surface exists so a 404 stays a real 404 (the page calls
 * `notFound()`, which sets the status) WITHOUT stranding the reader on the bare
 * framework page with no tree, no search and no way back.
 */
describe("KB not-found", () => {
  it("renders the tree alongside the message, so there is always a next click", async () => {
    const rendered = JSON.stringify(await KbNotFound());
    // The tree is what keeps the reader from being stranded, and it is built
    // rather than omitted the way the framework's default 404 omits it.
    expect(buildKbTreeMock).toHaveBeenCalledWith("/vault/cleared");
    expect(rendered).toContain("There is no document at this path.");
    // Rendered inside the KB layout, not as a bare page: it carries the
    // layout's own props, and manage mode is never entered from here.
    expect(rendered).toContain('"basePath":"/kb"');
    expect(rendered).toContain('"manage":false');
  });

  it("builds the tree from the requester's own root, never a wider one", async () => {
    requesterKbRootsMock.mockResolvedValue({
      treeRoot: "/vault/uncleared",
      readRoot: "/vault/uncleared",
      email: "bob@example.com",
      clearance: ["all-hands"],
      isAdmin: false,
    });
    await KbNotFound();
    // `false`: this file cannot see the request's manage flag, so it must never
    // opt into the admin projection.
    expect(requesterKbRootsMock).toHaveBeenCalledWith(false);
    expect(buildKbTreeMock).toHaveBeenCalledWith("/vault/uncleared");
  });

  it("offers no group list to a non-admin", async () => {
    const rendered = JSON.stringify(await KbNotFound());
    expect(rendered).toContain('"groups":[]');
  });
});
