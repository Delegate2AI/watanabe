import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const editorMock = vi.fn<(props: unknown) => null>(() => null);
vi.mock("@/components/artifacts/artifact-editor", () => ({
  ArtifactEditor: (props: unknown) => editorMock(props),
}));

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...a: unknown[]) => resolveIdentityMock(...a),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => "/vault/all-hands" }));
vi.mock("@/lib/artifacts/target-folders", () => ({
  targetFoldersForRoot: () => ["03-product", "07-governance"],
}));

const getArtifactForOwnerMock = vi.fn();
vi.mock("@/lib/db/artifacts", () => ({
  getArtifactForOwner: (...a: unknown[]) => getArtifactForOwnerMock(...a),
  getVersions: () => [],
  latestBody: () => "body",
}));

const effectiveCanWriteMock = vi.fn<(email: string) => boolean>(() => true);
vi.mock("@/lib/authority/write-gate", () => ({
  effectiveCanWrite: (email: string) => effectiveCanWriteMock(email),
  isKbWriteEnabled: () => true,
}));
const canMock = vi.fn<(email: string, capability: string) => boolean>(() => false);
vi.mock("@/lib/authority/roles", () => ({
  can: (email: string, capability: string) => canMock(email, capability),
}));

const Page = (await import("./page")).default;
const call = (id: string) => Page({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.ARTIFACTS_ENABLED = "1";
  notFoundMock.mockClear();
  editorMock.mockClear();
  effectiveCanWriteMock.mockReset().mockReturnValue(true);
  canMock.mockReset().mockReturnValue(false);
  resolveIdentityMock.mockReset().mockResolvedValue({
    email: "alice@example.com",
    clearance: ["all-hands"],
  });
  getArtifactForOwnerMock.mockReset().mockReturnValue({
    id: "a1",
    title: "T",
    status: "draft",
    targetPath: null,
    targetVisibility: null,
    publishedNotePath: null,
  });
});

describe("ArtifactDetailPage owner-scoping", () => {
  it("renders the editor for an owned artifact", async () => {
    await expect(call("a1")).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("passes the server-computed direct publish capability to the client editor", async () => {
    canMock.mockImplementation((_email: string, capability: string): boolean => capability === "approve");
    renderToStaticMarkup(await call("a1"));
    expect(canMock).toHaveBeenCalledWith("alice@example.com", "approve");
    expect(editorMock).toHaveBeenCalledWith(expect.objectContaining({
      canPublish: true,
      canPublishDirect: true,
      targetFolders: ["03-product", "07-governance"],
    }));
  });

  it("fails closed when the requester cannot publish directly", async () => {
    canMock.mockReturnValue(false);
    renderToStaticMarkup(await call("a1"));
    expect(editorMock).toHaveBeenCalledWith(expect.objectContaining({
      canPublish: true,
      canPublishDirect: false,
    }));
  });

  it("404s a foreign OR unknown id identically (store returns null for both)", async () => {
    getArtifactForOwnerMock.mockReturnValue(null);
    await expect(call("a1")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(call("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when there is no identity, without touching the store", async () => {
    resolveIdentityMock.mockResolvedValue(null);
    await expect(call("a1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getArtifactForOwnerMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    delete process.env.ARTIFACTS_ENABLED;
    await expect(call("a1")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
