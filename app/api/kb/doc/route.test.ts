import { afterEach, describe, expect, it, vi } from "vitest";

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...args: unknown[]) => resolveIdentityMock(...args),
}));
vi.mock("@/lib/repo", () => ({ vaultRootFor: (c: string[]) => `/vault/${c.join("+")}` }));

const resolveKbDocMock = vi.fn();
vi.mock("@/lib/kb/resolve", () => ({
  resolveKbDoc: (...args: unknown[]) => resolveKbDocMock(...args),
}));

const { GET } = await import("./route");

function req(path?: string): Request {
  const url = path === undefined ? "http://x/api/kb/doc" : `http://x/api/kb/doc?path=${encodeURIComponent(path)}`;
  return new Request(url);
}

afterEach(() => {
  resolveIdentityMock.mockReset();
  resolveKbDocMock.mockReset();
});

describe("GET /api/kb/doc", () => {
  it("401s an unauthenticated request", async () => {
    resolveIdentityMock.mockResolvedValue(null);
    const res = await GET(req("00-overview/executive-summary.md"));
    expect(res.status).toBe(401);
  });

  it("400s when no path is given", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it("reads through the clearance-scoped root and returns the doc body", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands", "exec"] });
    resolveKbDocMock.mockReturnValue({
      kind: "doc",
      relPath: "00-overview/executive-summary.md",
      slug: ["00-overview", "executive-summary.md"],
      note: { title: "Executive Summary", visibility: "all-hands", body: "# Hi" },
    });

    const res = await GET(req("00-overview/executive-summary.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "00-overview/executive-summary.md",
      title: "Executive Summary",
      visibility: "all-hands",
      group: undefined,
      body: "# Hi",
    });
    // Resolution happened against vaultRootFor(clearance), not a raw root.
    expect(resolveKbDocMock).toHaveBeenCalledWith(
      ["00-overview", "executive-summary.md"],
      "/vault/all-hands+exec",
    );
  });

  it("404s a doc absent from the requester's projection (restricted == missing)", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });
    resolveKbDocMock.mockReturnValue(null);
    const res = await GET(req("exec-only/secret.md"));
    expect(res.status).toBe(404);
  });

  it("404s a directory path (only docs are previewable)", async () => {
    resolveIdentityMock.mockResolvedValue({ email: "a@x.com", clearance: ["all-hands"] });
    resolveKbDocMock.mockReturnValue({ kind: "dir", relPath: "00-overview", slug: ["00-overview"] });
    const res = await GET(req("00-overview"));
    expect(res.status).toBe(404);
  });
});
