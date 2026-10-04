import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/identity")>();
  return { ...actual, requireIdentity: (...args: unknown[]) => requireIdentityMock(...args) };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ staff: ["alice@example.com", "bob@example.com"] }) };
});

vi.mock("@/lib/repo-write", () => ({ discard: async () => {} }));

const { GET, DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { mintToken, listTokens } = await import("@/lib/mcp-auth/tokens");

function request(query = ""): Request {
  return new Request(`http://t/api/settings/mcp-tokens${query}`, { method: "GET" });
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MCP_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "alice@example.com" } });
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
  db.close();
});

describe("GET", () => {
  it("lists the caller's own grants and nobody else's", async () => {
    mintToken(db, { ownerEmail: "alice@example.com", name: "Claude", clientId: "c1" });
    mintToken(db, { ownerEmail: "bob@example.com", name: "Bob's client", clientId: "c1" });

    const body = await (await GET(request())).json() as { tokens: Array<{ name: string }> };

    expect(body.tokens.map((t) => t.name)).toEqual(["Claude"]);
  });

  it("distinguishes an OAuth grant from a portal token", async () => {
    mintToken(db, { ownerEmail: "alice@example.com", name: "Claude", clientId: "c1" });
    mintToken(db, { ownerEmail: "alice@example.com", name: "laptop" });

    const body = await (await GET(request())).json() as { tokens: Array<{ name: string; clientId: string | null }> };

    expect(body.tokens.find((t) => t.name === "Claude")?.clientId).toBe("c1");
    expect(body.tokens.find((t) => t.name === "laptop")?.clientId).toBeNull();
  });

  // Owner-scoped by construction, so this needs no capability: it is not an
  // admin surface, it is a person's own list.
  it("needs no admin capability", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "bob@example.com" } });
    expect((await GET(request())).status).toBe(200);
  });

  it("is not found for an identity on no roster", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "stranger@example.com" } });
    expect((await GET(request())).status).toBe(404);
  });

  it("is not found with the feature off", async () => {
    delete process.env.MCP_ENABLED;
    expect((await GET(request())).status).toBe(404);
  });
});

describe("DELETE", () => {
  it("revokes the caller's own grant", async () => {
    const { id } = mintToken(db, { ownerEmail: "alice@example.com", name: "Claude", clientId: "c1" });

    expect((await DELETE(request(`?id=${id}`))).status).toBe(200);
    expect(listTokens(db, "alice@example.com")[0].revokedAt).not.toBeNull();
  });

  // Someone else's id and an invented one answer the same way, so the endpoint
  // cannot be used to discover which token ids exist.
  it("refuses another person's token exactly as it refuses an invented id", async () => {
    const theirs = mintToken(db, { ownerEmail: "bob@example.com", name: "Bob's", clientId: "c1" });

    const foreign = await DELETE(request(`?id=${theirs.id}`));
    const invented = await DELETE(request("?id=made-up"));

    expect(foreign.status).toBe(invented.status);
    expect(await foreign.text()).toBe(await invented.text());
    expect(listTokens(db, "bob@example.com")[0].revokedAt).toBeNull();
  });

  it("refuses a request naming no token", async () => {
    expect((await DELETE(request())).status).toBe(400);
  });
});
