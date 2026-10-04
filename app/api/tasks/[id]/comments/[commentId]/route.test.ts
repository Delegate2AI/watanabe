import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
  isRolesEnabled: () => false,
}));
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ exec: ["alice@example.com", "bob@example.com"] }) };
});
let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { PATCH, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { insertProposed } = await import("@/lib/db/tasks");
const { addComment, listComments } = await import("@/lib/db/task-comments");

const ALICE = { email: "alice@example.com" };
const BOB = { email: "bob@example.com" };

function context(id: string, commentId: string) {
  return { params: Promise.resolve({ id, commentId }) };
}
function patch(id: string, commentId: string, body: unknown): Request {
  return new Request(`http://t/api/tasks/${id}/comments/${commentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function del(id: string, commentId: string): Request {
  return new Request(`http://t/api/tasks/${id}/comments/${commentId}`, { method: "DELETE" });
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.TASKS_ENABLED = "1";
  process.env.TASK_COMMENTS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(false);
  const common = {
    description: "d", sourceMeetingId: null, sourceNotePath: null, due: null,
    origin: "manual" as const, createdAt: "2026-08-07T00:00:00.000Z", clearance: ["exec"],
  };
  insertProposed(db, { ...common, id: "t1", title: "One", assigneeEmail: null });
  insertProposed(db, { ...common, id: "t2", title: "Two", assigneeEmail: null });
  addComment(db, { id: "mine", taskId: "t1", authorEmail: ALICE.email, body: "mine", createdAt: "2026-08-07T00:01:00.000Z" });
  addComment(db, { id: "theirs", taskId: "t1", authorEmail: BOB.email, body: "theirs", createdAt: "2026-08-07T00:02:00.000Z" });
});

afterEach(() => {
  delete process.env.TASKS_ENABLED;
  delete process.env.TASK_COMMENTS_ENABLED;
});

describe("PATCH /api/tasks/[id]/comments/[commentId]", () => {
  it("edits your own comment and stamps edited", async () => {
    const res = await PATCH(patch("t1", "mine", { body: "edited" }), context("t1", "mine"));
    expect(res.status).toBe(200);
    const stored = listComments(db, "t1").find((c) => c.id === "mine");
    expect(stored?.body).toBe("edited");
    expect(stored?.editedAt).not.toBeNull();
  });

  it("403s another author's comment and changes nothing", async () => {
    const res = await PATCH(patch("t1", "theirs", { body: "hijacked" }), context("t1", "theirs"));
    expect(res.status).toBe(403);
    expect(listComments(db, "t1").find((c) => c.id === "theirs")?.body).toBe("theirs");
  });

  it("403s an admin editing someone else's comment: delete is the admin power, not rewrite", async () => {
    canMock.mockReturnValue(true);
    const res = await PATCH(patch("t1", "theirs", { body: "hijacked" }), context("t1", "theirs"));
    expect(res.status).toBe(403);
  });

  it("404s a comment id that belongs to a different task", async () => {
    const res = await PATCH(patch("t2", "mine", { body: "edited" }), context("t2", "mine"));
    expect(res.status).toBe(404);
    expect(listComments(db, "t1").find((c) => c.id === "mine")?.body).toBe("mine");
  });

  it("404s an unknown comment id", async () => {
    const res = await PATCH(patch("t1", "nope", { body: "edited" }), context("t1", "nope"));
    expect(res.status).toBe(404);
  });

  it("rejects an empty body", async () => {
    const res = await PATCH(patch("t1", "mine", { body: "   " }), context("t1", "mine"));
    expect(res.status).toBe(400);
  });

  it("404s when the flag is off", async () => {
    delete process.env.TASK_COMMENTS_ENABLED;
    const res = await PATCH(patch("t1", "mine", { body: "edited" }), context("t1", "mine"));
    expect(res.status).toBe(404);
  });

  it("404s a malformed body when the flag is off, not 400: the flag gate runs before the body parse", async () => {
    delete process.env.TASK_COMMENTS_ENABLED;
    const res = await PATCH(patch("t1", "mine", { body: 12345 }), context("t1", "mine"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tasks/[id]/comments/[commentId]", () => {
  it("deletes your own comment", async () => {
    const res = await DELETE(del("t1", "mine"), context("t1", "mine"));
    expect(res.status).toBe(200);
    expect(listComments(db, "t1").map((c) => c.id)).toEqual(["theirs"]);
  });

  it("403s another author's comment", async () => {
    const res = await DELETE(del("t1", "theirs"), context("t1", "theirs"));
    expect(res.status).toBe(403);
    expect(listComments(db, "t1")).toHaveLength(2);
  });

  it("lets an administrator delete anyone's comment", async () => {
    canMock.mockImplementation((_email: string, capability: string) => capability === "manageAccess");
    const res = await DELETE(del("t1", "theirs"), context("t1", "theirs"));
    expect(res.status).toBe(200);
    expect(listComments(db, "t1").map((c) => c.id)).toEqual(["mine"]);
  });

  it("404s a comment id that belongs to a different task, even for an administrator", async () => {
    canMock.mockReturnValue(true);
    const res = await DELETE(del("t2", "mine"), context("t2", "mine"));
    expect(res.status).toBe(404);
    expect(listComments(db, "t1")).toHaveLength(2);
  });
});
