import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
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

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { listOpenConnectorRequests } = await import("@/lib/db/connector-requests");

const ALICE = { email: "alice@example.com", name: "Alice" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/connectors/requests", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/connectors/requests", () => {
  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    const response = await POST(post({ text: "Please add connector X" }));

    expect(response.status).toBe(401);
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    const response = await POST(post({ text: "Please add connector X" }));

    expect(response.status).toBe(404);
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("rejects empty text with 400", async () => {
    const response = await POST(post({ text: "   " }));

    expect(response.status).toBe(400);
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("rejects text over 2000 characters with 400", async () => {
    const response = await POST(post({ text: "x".repeat(2001) }));

    expect(response.status).toBe(400);
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("creates a request attributed to the caller identity and returns its id", async () => {
    const response = await POST(post({ text: "Please add connector X" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string };
    expect(typeof body.id).toBe("string");

    const requests = listOpenConnectorRequests(db);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: body.id, requesterEmail: "alice@example.com", text: "Please add connector X" });
  });

  it("never attributes a request to a client-supplied email", async () => {
    await POST(post({ text: "Please add connector X", requesterEmail: "hacker@evil.com" }));

    const requests = listOpenConnectorRequests(db);
    expect(requests[0].requesterEmail).toBe("alice@example.com");
  });

  it("413s a body past the cap instead of buffering whatever arrives", async () => {
    const response = await POST(post({ text: "x".repeat(20_000) }));

    expect(response.status).toBe(413);
    expect(listOpenConnectorRequests(db)).toEqual([]);
  });

  it("400s a body that is not json", async () => {
    const response = await POST(post("not-json"));

    expect(response.status).toBe(400);
  });
});
