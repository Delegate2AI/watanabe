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

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createProject, getProjectForRequester } = await import("@/lib/db/projects");

const ALICE = { email: "alice@example.com", name: "Alice" };

beforeEach(() => {
  db = openDb(":memory:");
  process.env.PROJECTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
});

afterEach(() => {
  delete process.env.PROJECTS_ENABLED;
  delete process.env.AUTHORITY_ENABLED;
});

function post(body: unknown): Request {
  return new Request("http://t/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/projects", () => {
  it("lists only projects the requester is cleared for, as summaries", async () => {
    createProject(db, { id: "mine", name: "Mine", description: null, context: null, clearance: ["exec"], ownerEmail: ALICE.email, createdAt: "2026-07-01T00:00:00Z" });
    createProject(db, { id: "hidden", name: "Hidden", description: null, context: null, clearance: ["board"], ownerEmail: "bob@example.com", createdAt: "2026-07-02T00:00:00Z" });
    const res = await GET(new Request("http://t/api/projects"));
    expect(res.status).toBe(200);
    const data = await res.json() as { projects: Array<{ project: { id: string } }> };
    expect(data.projects.map((p) => p.project.id)).toEqual(["mine"]);
  });

  it("returns an empty surface when disabled", async () => {
    delete process.env.PROJECTS_ENABLED;
    const res = await GET(new Request("http://t/api/projects"));
    expect(await res.json()).toEqual({ projects: [] });
  });
});

describe("POST /api/projects", () => {
  it("defaults a new project's clearance to all-hands when authority is off", async () => {
    // Authority off (flag unset): group membership is inert, so the flag-aware
    // resolver collapses the caller to all-hands. Flag-off must not leak the
    // seeded group membership onto a new project.
    const res = await POST(post({ name: "Q3 Launch" }));
    expect(res.status).toBe(201);
    const data = await res.json() as { project: { id: string; clearance: string[] } };
    expect(data.project.clearance).toEqual(["all-hands"]);
    const stored = getProjectForRequester(db, data.project.id, ALICE.email, ["all-hands"]);
    expect(stored?.ownerEmail).toBe(ALICE.email);
    expect(stored?.clearance).toEqual(["all-hands"]);
  });

  it("defaults a new project's clearance to the caller's membership when authority is on", async () => {
    process.env.AUTHORITY_ENABLED = "1";
    const res = await POST(post({ name: "Q3 Launch" }));
    expect(res.status).toBe(201);
    const data = await res.json() as { project: { id: string; clearance: string[] } };
    expect([...data.project.clearance].sort()).toEqual(["all-hands", "exec"]);
  });

  it("rejects a clearance the caller is not part of (no privilege escalation)", async () => {
    const res = await POST(post({ name: "Sneaky", clearance: ["board"] }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing name", async () => {
    const res = await POST(post({ description: "no name" }));
    expect(res.status).toBe(400);
  });

  it("404s the create when disabled", async () => {
    delete process.env.PROJECTS_ENABLED;
    const res = await POST(post({ name: "Nope" }));
    expect(res.status).toBe(404);
  });
});
