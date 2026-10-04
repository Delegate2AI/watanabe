import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isConnectorsEnabledMock = vi.fn();
vi.mock("@/lib/connectors/config", () => ({
  isConnectorsEnabled: () => isConnectorsEnabledMock(),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, PATCH } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createConnectorRequest } = await import("@/lib/db/connector-requests");

const ADMIN = { email: "admin@example.com", name: "Admin" };

function get(): Request {
  return new Request("http://localhost/api/admin/connectors/requests");
}

function patch(body: unknown): Request {
  return new Request("http://localhost/api/admin/connectors/requests", {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ADMIN });
  canMock.mockReset().mockReturnValue(true);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/connectors/requests", () => {
  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    const response = await GET(get());

    expect(response.status).toBe(401);
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(404);
  });

  it("403s a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("lists open requests with the open count", async () => {
    createConnectorRequest(db, { requesterEmail: "alice@example.com", text: "Add connector X" });
    createConnectorRequest(db, { requesterEmail: "bob@example.com", text: "Add connector Y" });

    const response = await GET(get());

    expect(response.status).toBe(200);
    const body = (await response.json()) as { requests: Array<{ text: string }>; openCount: number };
    expect(body.openCount).toBe(2);
    expect(body.requests.map((r) => r.text).sort()).toEqual(["Add connector X", "Add connector Y"]);
  });
});

describe("PATCH /api/admin/connectors/requests", () => {
  it("401s without an identity, before resolving", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    const response = await PATCH(patch({ id: "whatever" }));

    expect(response.status).toBe(401);
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    const response = await PATCH(patch({ id: "whatever" }));

    expect(response.status).toBe(404);
  });

  it("403s a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await PATCH(patch({ id: "whatever" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("resolves an open request and answers 400 on a second attempt", async () => {
    const id = createConnectorRequest(db, { requesterEmail: "alice@example.com", text: "Add connector X" });

    const first = await PATCH(patch({ id }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ resolved: true });

    const second = await PATCH(patch({ id }));
    expect(second.status).toBe(400);
  });

  it("400s an unknown id", async () => {
    const response = await PATCH(patch({ id: "does-not-exist" }));

    expect(response.status).toBe(400);
  });

  it("400s a body that is not json", async () => {
    const response = await PATCH(patch("not-json"));

    expect(response.status).toBe(400);
  });
});
