import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: () => ["all-hands", "exec"],
}));
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => "/missing-projection" }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { getCursor } = await import("@/lib/db/activity");
const { insertProposed } = await import("@/lib/db/tasks");

const alice = { email: "alice@example.com", name: "Alice" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T14:00:00.000Z"));
  db = openDb(":memory:");
  process.env.ACTIVITY_ENABLED = "1";
  process.env.MEETINGS_ENABLED = "1";
  process.env.TASKS_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: alice });
  getCursor(db, alice.email);
  insertProposed(db, {
    id: "mine",
    title: "Review follow-up",
    description: "Description",
    assigneeEmail: alice.email,
    sourceMeetingId: "meeting:1",
    sourceNotePath: "docs/meetings/one.md",
    clearance: ["exec"],
    due: null,
    origin: "circleback",
    createdAt: "2026-07-11T13:00:00.000Z",
  });
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  delete process.env.ACTIVITY_ENABLED;
  delete process.env.MEETINGS_ENABLED;
  delete process.env.TASKS_ENABLED;
});

describe("activity route", () => {
  it("returns the requester's grouped feed and unread count", async () => {
    const response = await GET(new Request("http://test/api/activity"));
    expect(response.status).toBe(200);
    const body = await response.json() as { unreadCount: number; tasks: Array<{ id: string }> };
    expect(body.unreadCount).toBe(1);
    expect(body.tasks.map((item) => item.id)).toEqual(["mine"]);
  });

  it("advances the cursor when activity is marked seen", async () => {
    const response = await POST(new Request("http://test/api/activity/seen", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lastSeenAt: "2026-07-11T14:00:00.000Z" });
    const refreshed = await GET(new Request("http://test/api/activity"));
    expect((await refreshed.json() as { unreadCount: number }).unreadCount).toBe(0);
  });

  it("returns the identity failure without touching activity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "sign in" }, { status: 401 }) });
    expect((await GET(new Request("http://test/api/activity"))).status).toBe(401);
  });

  it("is dormant when ACTIVITY_ENABLED is off", async () => {
    delete process.env.ACTIVITY_ENABLED;
    const response = await GET(new Request("http://test/api/activity"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });
});
