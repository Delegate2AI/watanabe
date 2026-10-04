import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ exec: ["alice@example.com"] }) };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const readProjectDocumentMock = vi.fn();
vi.mock("@/lib/projects/doc-store", () => ({
  readProjectDocument: (...args: unknown[]) => readProjectDocumentMock(...args),
}));

const { GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createProject } = await import("@/lib/db/projects");
const { insertProjectDocument } = await import("@/lib/db/project-docs");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

function ctx(id: string, docId: string) {
  return { params: Promise.resolve({ id, docId }) };
}
const request = () => new Request("http://t/api/projects/p1/documents/d1");

beforeEach(() => {
  db = openDb(":memory:");
  process.env.PROJECTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  readProjectDocumentMock.mockReset().mockReturnValue(Buffer.from("# handbook outline\n"));
  createProject(db, {
    id: "p1",
    name: "Exec plan",
    description: null,
    context: null,
    clearance: ["exec"],
    ownerEmail: ALICE.email,
    createdAt: "2026-07-01T00:00:00Z",
  });
  insertProjectDocument(db, {
    id: "d1",
    projectId: "p1",
    filename: "handbook-outline.md",
    contentType: "text/markdown",
    byteSize: 19,
    uploaderEmail: ALICE.email,
    createdAt: "2026-07-02T00:00:00Z",
  });
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
});

describe("GET /api/projects/[id]/documents/[docId]", () => {
  it("serves the bytes to a cleared requester", async () => {
    const res = await GET(request(), ctx("p1", "d1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    expect(res.headers.get("content-disposition")).toContain("handbook-outline.md");
    expect(await res.text()).toBe("# handbook outline\n");
  });

  it("404s an uncleared requester, indistinguishably from a missing document", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const uncleared = await GET(request(), ctx("p1", "d1"));
    requireIdentityMock.mockResolvedValue({ identity: ALICE });
    const missing = await GET(request(), ctx("p1", "nope"));

    expect(uncleared.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await uncleared.json()).toEqual(await missing.json());
  });

  it("404s a document filed under another project", async () => {
    createProject(db, {
      id: "p2",
      name: "Other",
      description: null,
      context: null,
      clearance: ["exec"],
      ownerEmail: ALICE.email,
      createdAt: "2026-07-01T00:00:00Z",
    });
    const res = await GET(request(), ctx("p2", "d1"));
    expect(res.status).toBe(404);
  });

  it("404s when the bytes are gone from disk", async () => {
    readProjectDocumentMock.mockReturnValue(null);
    const res = await GET(request(), ctx("p1", "d1"));
    expect(res.status).toBe(404);
  });

  it("404s with the flag off", async () => {
    delete process.env.PROJECTS_ENABLED;
    const res = await GET(request(), ctx("p1", "d1"));
    expect(res.status).toBe(404);
  });
});
