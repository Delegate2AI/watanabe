import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return {
    ...actual,
    loadGroups: () => ({ exec: ["alice@example.com", "bob@example.com"], board: ["carol@example.com"] }),
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
const { addComment, listComments } = await import("@/lib/db/task-comments");

const ALICE = { email: "alice@example.com" };
const CAROL = { email: "carol@example.com" };

function context(id: string) { return { params: Promise.resolve({ id }) }; }
function get(id: string): Request { return new Request(`http://t/api/tasks/${id}/comments`); }
function post(id: string, body: unknown): Request {
  return new Request(`http://t/api/tasks/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.TASKS_ENABLED = "1";
  process.env.TASK_COMMENTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  const common = {
    description: "d", sourceMeetingId: null, sourceNotePath: null,
    due: null, origin: "manual" as const, createdAt: "2026-08-07T00:00:00.000Z",
  };
  insertProposed(db, { ...common, id: "open-task", title: "Open", assigneeEmail: null, clearance: ["exec"] });
  insertProposed(db, { ...common, id: "secret", title: "Secret", assigneeEmail: null, clearance: ["board"] });
});

afterEach(() => {
  delete process.env.TASKS_ENABLED;
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("GET /api/tasks/[id]/comments", () => {
  it("returns the comments oldest first", async () => {
    addComment(db, { id: "c1", taskId: "open-task", authorEmail: ALICE.email, body: "first", createdAt: "2026-08-07T00:01:00.000Z" });
    addComment(db, { id: "c2", taskId: "open-task", authorEmail: ALICE.email, body: "second", createdAt: "2026-08-07T00:02:00.000Z" });

    const res = await GET(get("open-task"), context("open-task"));
    expect(res.status).toBe(200);
    const data = await res.json() as { comments: Array<{ id: string }> };
    expect(data.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("404s a task the caller is not cleared for", async () => {
    const res = await GET(get("secret"), context("secret"));
    expect(res.status).toBe(404);
  });

  it("404s an unknown id, indistinguishably", async () => {
    const res = await GET(get("nope"), context("nope"));
    expect(res.status).toBe(404);
  });

  it("404s when the flag is off", async () => {
    delete process.env.TASK_COMMENTS_ENABLED;
    const res = await GET(get("open-task"), context("open-task"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tasks/[id]/comments", () => {
  it("creates a comment authored by the caller", async () => {
    const res = await POST(post("open-task", { body: "hello" }), context("open-task"));
    expect(res.status).toBe(201);
    const stored = listComments(db, "open-task");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ authorEmail: ALICE.email, body: "hello", editedAt: null });
  });

  it("trims the body and rejects one that is empty or whitespace", async () => {
    const padded = await POST(post("open-task", { body: "  spaced  " }), context("open-task"));
    expect(padded.status).toBe(201);
    expect(listComments(db, "open-task")[0].body).toBe("spaced");

    for (const body of ["", "   ", "\n\t"]) {
      const res = await POST(post("open-task", { body }), context("open-task"));
      expect(res.status).toBe(400);
    }
    expect(listComments(db, "open-task")).toHaveLength(1);
  });

  it("rejects a body over 10000 characters", async () => {
    const res = await POST(post("open-task", { body: "x".repeat(10_001) }), context("open-task"));
    expect(res.status).toBe(400);
    expect(listComments(db, "open-task")).toEqual([]);
  });

  it("rejects a malformed body", async () => {
    const res = await POST(post("open-task", { nope: 1 }), context("open-task"));
    expect(res.status).toBe(400);
  });

  it("404s a task the caller is not cleared for, and writes nothing", async () => {
    const res = await POST(post("secret", { body: "hello" }), context("secret"));
    expect(res.status).toBe(404);
    expect(listComments(db, "secret")).toEqual([]);
  });

  it("lets a cleared non-assignee comment", async () => {
    requireIdentityMock.mockResolvedValue({ identity: CAROL });
    const allowed = await POST(post("secret", { body: "board only" }), context("secret"));
    expect(allowed.status).toBe(201);
    const denied = await POST(post("open-task", { body: "not mine" }), context("open-task"));
    expect(denied.status).toBe(404);
  });

  it("404s when the flag is off", async () => {
    delete process.env.TASK_COMMENTS_ENABLED;
    const res = await POST(post("open-task", { body: "hello" }), context("open-task"));
    expect(res.status).toBe(404);
    expect(listComments(db, "open-task")).toEqual([]);
  });
});
