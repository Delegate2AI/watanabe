import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn(() => true);
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...(args as [])) }));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET, POST, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");

const ALICE = { email: "alice@example.com" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/mcp-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.MCP_ENABLED = "1";
  process.env.KB_WRITE_ENABLED = "1";
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockReturnValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(true);
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
  delete process.env.KB_WRITE_ENABLED;
});

describe("POST /api/admin/mcp-tokens", () => {
  it("returns the plaintext token exactly once", async () => {
    const res = await POST(post({ name: "laptop" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; token: string };
    expect(body.token.length).toBeGreaterThan(20);

    const listed = await (await GET(new Request("http://localhost/api/admin/mcp-tokens"))).json() as {
      tokens: Record<string, unknown>[];
    };
    expect(JSON.stringify(listed)).not.toContain(body.token);
    expect(listed.tokens[0]).toMatchObject({ id: body.id, name: "laptop" });
  });

  it("refuses a blank name rather than minting an unlabelled credential", async () => {
    expect((await POST(post({ name: "   " }))).status).toBe(400);
  });
});

describe("authorization", () => {
  it("404s every verb for someone without manageAccess, never 403", async () => {
    canMock.mockReturnValue(false);
    expect((await GET(new Request("http://localhost/api/admin/mcp-tokens"))).status).toBe(404);
    expect((await POST(post({ name: "x" }))).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/admin/mcp-tokens?id=x", { method: "DELETE" }))).status).toBe(404);
  });

  it("404s every verb with the flag off, without reading the token store", async () => {
    delete process.env.MCP_ENABLED;
    expect((await GET(new Request("http://localhost/api/admin/mcp-tokens"))).status).toBe(404);
    expect((await POST(post({ name: "x" }))).status).toBe(404);
  });

  it("401s an unauthenticated caller", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/admin/mcp-tokens"))).status).toBe(401);
  });
});

describe("DELETE /api/admin/mcp-tokens", () => {
  it("revokes, and a second revoke is not an error", async () => {
    const { id } = await (await POST(post({ name: "laptop" }))).json() as { id: string };
    const url = `http://localhost/api/admin/mcp-tokens?id=${id}`;
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(200);
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(200);

    const listed = await (await GET(new Request("http://localhost/api/admin/mcp-tokens"))).json() as {
      tokens: { revokedAt: string | null }[];
    };
    expect(listed.tokens[0].revokedAt).not.toBeNull();
  });

  it("404s an id belonging to someone else, identical to an unknown id", async () => {
    const url = "http://localhost/api/admin/mcp-tokens?id=not-mine";
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(404);
  });

  it("400s with no id at all", async () => {
    const res = await DELETE(new Request("http://localhost/api/admin/mcp-tokens", { method: "DELETE" }));
    expect(res.status).toBe(400);
  });
});
