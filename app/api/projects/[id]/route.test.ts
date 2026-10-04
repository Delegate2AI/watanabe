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

const { GET, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createProject, getProjectForRequester } = await import("@/lib/db/projects");
const { recordThread } = await import("@/lib/db/threads");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

beforeEach(() => {
  db = openDb(":memory:");
  process.env.PROJECTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  createProject(db, { id: "p1", name: "Q3", description: "d", context: "ctx", clearance: ["all-hands"], ownerEmail: ALICE.email, createdAt: "2026-07-01T00:00:00Z" });
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function patch(id: string, body: unknown): Request {
  return new Request(`http://t/api/projects/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/projects/[id]", () => {
  it("returns the project with its threads and tasks for a cleared requester", async () => {
    recordThread(db, "t1", ALICE.email, "chat");
    const res = await GET(new Request("http://t/api/projects/p1"), ctx("p1"));
    expect(res.status).toBe(200);
    const data = await res.json() as { project: { id: string }; threads: unknown[]; tasks: unknown[] };
    expect(data.project.id).toBe("p1");
    expect(Array.isArray(data.threads)).toBe(true);
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  it("404s a foreign project and an unknown id alike (no oracle)", async () => {
    createProject(db, { id: "foreign", name: "F", description: null, context: null, clearance: ["board"], ownerEmail: BOB.email, createdAt: "2026-07-01T00:00:00Z" });
    const foreign = await GET(new Request("http://t/api/projects/foreign"), ctx("foreign"));
    const unknown = await GET(new Request("http://t/api/projects/nope"), ctx("nope"));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});

describe("PATCH /api/projects/[id]", () => {
  it("lets the owner update description and context", async () => {
    const res = await PATCH(patch("p1", { action: "update", description: "new", context: "newctx" }), ctx("p1"));
    expect(res.status).toBe(200);
    expect(getProjectForRequester(db, "p1", ALICE.email, ["all-hands"])?.description).toBe("new");
  });

  it("403s a cleared non-owner trying to update", async () => {
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const res = await PATCH(patch("p1", { action: "update", description: "hijack" }), ctx("p1"));
    expect(res.status).toBe(403);
  });

  it("attaches a thread the caller owns", async () => {
    recordThread(db, "t1", ALICE.email, "chat");
    const res = await PATCH(patch("p1", { action: "attachThread", threadId: "t1" }), ctx("p1"));
    expect(res.status).toBe(200);
  });

  it("rejects attaching a thread the caller does not own", async () => {
    recordThread(db, "t1", BOB.email, "bobs");
    const res = await PATCH(patch("p1", { action: "attachThread", threadId: "t1" }), ctx("p1"));
    expect(res.status).toBe(400);
  });

  it("404s any action on a foreign project (no oracle)", async () => {
    createProject(db, { id: "foreign", name: "F", description: null, context: null, clearance: ["board"], ownerEmail: BOB.email, createdAt: "2026-07-01T00:00:00Z" });
    const res = await PATCH(patch("foreign", { action: "update", description: "x" }), ctx("foreign"));
    expect(res.status).toBe(404);
  });
});
