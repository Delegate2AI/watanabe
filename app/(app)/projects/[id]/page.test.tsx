import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

// Client sub-components: stub so the server page renders bare.
vi.mock("@/components/projects/project-context-editor", () => ({ ProjectContextEditor: () => null }));
vi.mock("@/components/projects/project-chat", () => ({ ProjectChat: () => null }));
vi.mock("@/components/projects/project-documents", () => ({ ProjectDocuments: () => null }));
vi.mock("@/components/projects/project-references", () => ({ ProjectReferences: () => null }));
vi.mock("@/components/tasks/task-card", () => ({ TaskCard: () => null }));
vi.mock("@/lib/db/project-docs", () => ({ listProjectDocuments: () => [] }));
vi.mock("@/lib/db/project-references", () => ({
  resolveProjectReferences: () => [],
  attachableFor: () => [],
}));

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveIdentity: (...a: unknown[]) => resolveIdentityMock(...a),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const getProjectForRequesterMock = vi.fn();
vi.mock("@/lib/db/projects", () => ({
  getProjectForRequester: (...a: unknown[]) => getProjectForRequesterMock(...a),
  listThreads: () => [],
  listTasks: () => [],
}));

// Spied, not replaced: this only records which addresses the page asked for.
const resolvePeopleMock = vi.fn();
vi.mock("@/lib/people/resolve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/people/resolve")>();
  return {
    ...actual,
    resolvePeople: (emails: readonly string[], options?: unknown) => {
      resolvePeopleMock(emails, options);
      return actual.resolvePeople(emails, options as Parameters<typeof actual.resolvePeople>[1]);
    },
  };
});

const Page = (await import("./page")).default;
const call = (id: string) => Page({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.PROJECTS_ENABLED = "1";
  notFoundMock.mockClear();
  resolveIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com", clearance: ["all-hands"] });
  getProjectForRequesterMock.mockReset().mockReturnValue({
    id: "p1",
    name: "Q3",
    description: "d",
    context: "ctx",
    clearance: ["all-hands"],
    ownerEmail: "alice@example.com",
    createdAt: "2026-07-01T00:00:00Z",
  });
});

describe("ProjectDetailPage clearance-scoping", () => {
  it("renders the project for a cleared requester", async () => {
    await expect(call("p1")).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("404s a foreign OR unknown id identically (store returns null for both)", async () => {
    getProjectForRequesterMock.mockReturnValue(null);
    await expect(call("p1")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(call("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when there is no identity, without touching the store", async () => {
    resolveIdentityMock.mockResolvedValue(null);
    await expect(call("p1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getProjectForRequesterMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    delete process.env.PROJECTS_ENABLED;
    await expect(call("p1")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Uploading a document adds its row client-side, and the uploader is resolved
  // against this map. Without the viewer in it, the document you just uploaded
  // is credited to your raw email address until the next full page load.
  it("resolves the viewer even when nothing on the project is theirs yet", async () => {
    resolvePeopleMock.mockClear();
    await call("p1");
    const [emails] = resolvePeopleMock.mock.calls.at(-1) ?? [[]];
    expect(emails).toContain("alice@example.com");
  });
});
