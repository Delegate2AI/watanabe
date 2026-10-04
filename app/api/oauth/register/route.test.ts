import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { GET: METADATA } = await import("@/app/.well-known/oauth-authorization-server/route");
const { openDb } = await import("@/lib/db/client");
const { getClient } = await import("@/lib/mcp-auth/clients");
const { resetRateLimits } = await import("@/lib/http/rate-limit");

function register(body: unknown, ip = "203.0.113.1"): Request {
  return new Request("http://t/api/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

const VALID = { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };

beforeEach(() => {
  db = openDb(":memory:");
  resetRateLimits();
  process.env.MCP_ENABLED = "1";
  process.env.MCP_PUBLIC_ORIGIN = "https://wb.example.test";
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_PUBLIC_ORIGIN;
  db.close();
});

describe("POST /api/oauth/register", () => {
  it("registers a client and hands back an id with no secret anywhere in the response", async () => {
    const response = await POST(register(VALID));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.token_endpoint_auth_method).toBe("none");
    // The property the whole design rests on. Asserted against the serialized
    // body, so a secret cannot arrive under a name this test did not think of.
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
    expect(getClient(db, body.client_id as string)?.clientName).toBe("Claude");
  });

  it("needs no credential of its own, because registering grants nothing", async () => {
    // No identity header, no cookie, no bearer: a client that has never met
    // this deployment has none of those, and every authorization still needs a
    // human at /oauth/authorize.
    const response = await POST(register(VALID));
    expect(response.status).toBe(201);
  });

  it.each([
    ["a plain http redirect", { client_name: "X", redirect_uris: ["http://evil.test/cb"] }],
    ["a wildcard redirect", { client_name: "X", redirect_uris: ["https://*.claude.ai/cb"] }],
    ["no redirect at all", { client_name: "X", redirect_uris: [] }],
    ["a blank name", { client_name: "  ", redirect_uris: ["https://x.test/cb"] }],
    ["a missing field", { client_name: "X" }],
  ])("refuses %s in the shape an OAuth client expects", async (_label, body) => {
    const response = await POST(register(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_client_metadata" });
  });

  it("rate limits an anonymous caller rather than letting it fill the table", async () => {
    for (let i = 0; i < 10; i++) expect((await POST(register(VALID))).status).toBe(201);

    const refused = await POST(register(VALID));
    expect(refused.status).toBe(429);
  });

  it("counts each caller separately, so one noisy client cannot lock everyone out", async () => {
    for (let i = 0; i < 10; i++) await POST(register(VALID, "203.0.113.1"));

    expect((await POST(register(VALID, "203.0.113.9"))).status).toBe(201);
  });

  it("is not found with the feature off, and writes nothing", async () => {
    delete process.env.MCP_ENABLED;

    expect((await POST(register(VALID))).status).toBe(404);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM oauth_clients`).get()).toEqual({ n: 0 });
  });

  it("is not found when the deployment has no public origin configured", async () => {
    delete process.env.MCP_PUBLIC_ORIGIN;
    expect((await POST(register(VALID))).status).toBe(404);
  });
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("advertises the endpoints a client needs to start, readable cross-origin", async () => {
    const response = await METADATA();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toMatchObject({
      issuer: "https://wb.example.test",
      registration_endpoint: "https://wb.example.test/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("is a 404 with the feature off, so flag-off advertises nothing", async () => {
    delete process.env.MCP_ENABLED;
    expect((await METADATA()).status).toBe(404);
  });
});
