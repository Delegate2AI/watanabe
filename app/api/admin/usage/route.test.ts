import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/roles")>();
  return { ...actual, can: (...args: unknown[]) => canMock(...args) };
});

vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ admins: ["admin@example.com"] }) };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, dynamic, runtime } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { recordUsage } = await import("@/lib/db/usage");

const saved = { ...process.env };

function get(queryString: string): Request {
  return new Request(`http://t/api/admin/usage${queryString}`);
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.USAGE_AUDIT_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  recordUsage(db, [
    {
      resultId: "r1",
      at: "2026-09-07T10:00:00.000Z",
      source: "chat",
      ownerEmail: "alice@example.com",
      threadId: "thread-1",
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 1.5,
      durationMs: 900,
      ok: true,
    },
  ]);
});

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("GET /api/admin/usage", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s with the flag off, before it asks who is calling", async () => {
    process.env.USAGE_AUDIT_ENABLED = "0";

    const response = await GET(get("?from=2026-09-01&to=2026-09-30"));

    expect(response.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("returns the identity gate's own response when there is no identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await GET(get("?from=2026-09-01&to=2026-09-30"))).status).toBe(401);
  });

  it("refuses a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await GET(get("?from=2026-09-01&to=2026-09-30"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("refuses a malformed date with 400", async () => {
    const response = await GET(get("?from=yesterday&to=2026-09-30"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "from" } });
  });

  it("answers the summary view", async () => {
    const response = await GET(get("?from=2026-09-01&to=2026-09-30"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.grand).toMatchObject({ turns: 1, costUsd: 1.5 });
    expect(body.owners[0].ownerEmail).toBe("alice@example.com");
  });

  it("answers the threads view for one owner and refuses it without one", async () => {
    const response = await GET(get("?view=threads&owner=alice@example.com&from=2026-09-01&to=2026-09-30"));

    expect(response.status).toBe(200);
    expect((await response.json()).threads[0]).toMatchObject({ threadId: "thread-1", turns: 1 });
    expect((await GET(get("?view=threads&from=2026-09-01&to=2026-09-30"))).status).toBe(400);
  });

  it("answers the csv view as an attachment", async () => {
    const response = await GET(get("?view=csv&from=2026-09-01&to=2026-09-30"));

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("usage-2026-09-01-2026-09-30.csv");
    expect((await response.text()).trimEnd().split("\n")).toHaveLength(2);
  });

  it("refuses an unknown view", async () => {
    expect((await GET(get("?view=invented&from=2026-09-01&to=2026-09-30"))).status).toBe(400);
  });
});
