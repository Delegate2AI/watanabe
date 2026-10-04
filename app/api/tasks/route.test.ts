import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return {
    ...actual,
    loadGroups: () => ({ exec: ["alice@example.com", "bob@example.com"], eng: ["alice@example.com"] }),
  };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertProposed } = await import("@/lib/db/tasks");

const ALICE = { email: "alice@example.com", name: "Alice" };

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  const common = {
    description: "Description",
    sourceMeetingId: "circleback:m1",
    sourceNotePath: "docs/meetings/m1.md",
    clearance: ["exec"],
    due: null,
    origin: "circleback" as const,
    createdAt: "2026-07-11T12:00:00Z",
  };
  insertProposed(db, { ...common, id: "mine", title: "Mine", assigneeEmail: ALICE.email });
  insertProposed(db, { ...common, id: "foreign", title: "Foreign", assigneeEmail: "bob@example.com" });
  insertProposed(db, { ...common, id: "triage", title: "Triage", assigneeEmail: null });
});

afterEach(() => {
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
});

describe("GET /api/tasks", () => {
  it("returns only the requester's assigned tasks and cleared triage", async () => {
    const response = await GET(new Request("http://t/api/tasks"));
    expect(response.status).toBe(200);
    const data = await response.json() as { tasks: Array<{ id: string }> };
    expect(data.tasks.map((task) => task.id).sort()).toEqual(["mine", "triage"]);
  });

  it("returns an empty surface when disabled", async () => {
    delete process.env.TASKS_ENABLED;
    const response = await GET(new Request("http://t/api/tasks"));
    expect(await response.json()).toEqual({ tasks: [] });
  });

  // This handler alone passes the identity's address into the query without
  // lowercasing it first; every sibling normalizes. The difference is inert,
  // because resolveClearance and requesterKey both canonicalize through
  // canonicalEmail, which lowercases before it looks anything up. Pinned here so
  // that normalizing this path stays a provable no-op rather than a hope.
  it("answers the same list whichever case the identity arrives in", async () => {
    const lower = await (await GET(new Request("http://t/api/tasks"))).json();

    requireIdentityMock.mockResolvedValue({ identity: { email: "Alice@Example.com", name: "Alice" } });
    const mixed = await (await GET(new Request("http://t/api/tasks"))).json();

    expect(mixed).toEqual(lower);
  });
});

// The identity 401 is a different body shape from the failure contract:
// unauthorized() answers { error: "<sentence>" } while fail() answers
// { error: { code } }. requireIdentity therefore stays inline in the handler and
// its response is returned untouched. Folding it into the service adapter would
// silently change the unauthenticated response of every route in the app.
it("returns the identity 401 unchanged, not a failure-contract envelope", async () => {
  requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no identity" }, { status: 401 }) });

  const response = await GET(new Request("http://t/api/tasks"));

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "no identity" });
});

function postRequest(body: unknown): Request {
  return new Request("http://t/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tasks", () => {
  it("creates a manual task for a group the creator belongs to", async () => {
    const response = await POST(postRequest({ title: "Write spec", clearance: "exec", assigneeEmail: "bob@example.com" }));
    expect(response.status).toBe(201);
    const { task } = await response.json() as { task: { id: string; status: string; origin: string; assigneeEmail: string } };
    expect(task.status).toBe("open");
    expect(task.origin).toBe("manual");
    expect(task.assigneeEmail).toBe("bob@example.com");
  });

  it("rejects a blank title", async () => {
    const response = await POST(postRequest({ title: "   ", clearance: "exec" }));
    expect(response.status).toBe(400);
  });

  it("rejects a clearance group the creator is not in", async () => {
    const response = await POST(postRequest({ title: "T", clearance: "board" }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown assignee", async () => {
    const response = await POST(postRequest({ title: "T", clearance: "exec", assigneeEmail: "stranger@example.com" }));
    expect(response.status).toBe(400);
  });

  it("404s when the subsystem is disabled", async () => {
    delete process.env.TASKS_ENABLED;
    const response = await POST(postRequest({ title: "T", clearance: "exec" }));
    expect(response.status).toBe(404);
  });
});
