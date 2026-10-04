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

const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const writeConnectorsMock = vi.fn();
vi.mock("@/lib/connectors/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/store")>();
  return { ...actual, writeConnectors: (...args: unknown[]) => writeConnectorsMock(...args) };
});

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const listCredentialOwnersMock = vi.fn();
const deleteCredentialsForSlugMock = vi.fn();
vi.mock("@/lib/db/connector-credentials", () => ({
  listCredentialOwners: (...args: unknown[]) => listCredentialOwnersMock(...args),
  deleteCredentialsForSlug: (...args: unknown[]) => deleteCredentialsForSlugMock(...args),
}));

const evictSessionsForOwnerMock = vi.fn();
const evictAllWarmSessionsMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: (...args: unknown[]) => evictSessionsForOwnerMock(...args),
  evictAllWarmSessions: (...args: unknown[]) => evictAllWarmSessionsMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };

const UPSERT = {
  verb: "upsert",
  slug: "linear",
  entry: {
    title: "Linear",
    transport: "http",
    url: "https://linear.example/mcp",
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
    groups: ["eng"],
  },
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/connectors", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeConnectorsMock.mockReset().mockResolvedValue({ ok: true });
  listCredentialOwnersMock.mockReset().mockReturnValue([]);
  deleteCredentialsForSlugMock.mockReset();
  evictSessionsForOwnerMock.mockReset();
  evictAllWarmSessionsMock.mockReset();
  process.env.LINEAR_TOKEN = "set";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("POST /api/admin/connectors, oauth eviction on edit/delete", () => {
  it("evicts every owner with a credential on the slug after a successful upsert", async () => {
    listCredentialOwnersMock.mockReturnValue(["alice@example.com", "bob@example.com"]);

    const response = await POST(post(UPSERT));

    expect(response.status).toBe(200);
    expect(listCredentialOwnersMock).toHaveBeenCalledWith({}, "linear");
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith("alice@example.com");
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith("bob@example.com");
  });

  it("evicts every owner with a credential on the slug after a successful remove", async () => {
    listCredentialOwnersMock.mockReturnValue(["alice@example.com"]);

    const response = await POST(post({ verb: "remove", slug: "linear" }));

    expect(response.status).toBe(200);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith("alice@example.com");
  });

  it("evicts nobody when no caller holds a credential on the slug", async () => {
    const response = await POST(post(UPSERT));

    expect(response.status).toBe(200);
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("falls back to evicting every warm session when the eviction lookup itself fails, and still reports success", async () => {
    listCredentialOwnersMock.mockImplementation(() => {
      throw new Error("db unavailable");
    });

    const response = await POST(post(UPSERT));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(evictAllWarmSessionsMock).toHaveBeenCalled();
  });

  it("never looks up eviction owners when the write itself failed", async () => {
    writeConnectorsMock.mockResolvedValue({ ok: false, error: "invalid connector entry" });

    await POST(post(UPSERT));

    expect(listCredentialOwnersMock).not.toHaveBeenCalled();
  });

  it("deletes every credential row for the slug after a successful remove, after eviction", async () => {
    listCredentialOwnersMock.mockReturnValue(["alice@example.com"]);
    const order: string[] = [];
    evictSessionsForOwnerMock.mockImplementation(() => order.push("evict"));
    deleteCredentialsForSlugMock.mockImplementation(() => order.push("delete"));

    const response = await POST(post({ verb: "remove", slug: "linear" }));

    expect(response.status).toBe(200);
    expect(deleteCredentialsForSlugMock).toHaveBeenCalledWith({}, "linear");
    expect(order).toEqual(["evict", "delete"]);
  });

  it("evicts every warm session, not just credential owners, when an upsert flips the auth field on an existing entry", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ slug: "linear", title: "Linear", transport: "http", url: "https://linear.example/mcp", groups: ["eng"] }],
      errors: [],
    });

    const oauthEntry = { title: "Linear", transport: "http", url: "https://linear.example/mcp", groups: ["eng"], auth: "oauth", oauthClientId: "client-1" };
    const response = await POST(post({ verb: "upsert", slug: "linear", entry: oauthEntry }));

    expect(response.status).toBe(200);
    expect(evictAllWarmSessionsMock).toHaveBeenCalled();
    expect(listCredentialOwnersMock).not.toHaveBeenCalled();
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("evicts only credential owners when an upsert leaves the auth field unchanged", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ slug: "linear", title: "Linear", transport: "http", url: "https://old.example/mcp", groups: ["eng"] }],
      errors: [],
    });
    listCredentialOwnersMock.mockReturnValue(["alice@example.com"]);

    const response = await POST(post(UPSERT));

    expect(response.status).toBe(200);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith("alice@example.com");
    expect(evictAllWarmSessionsMock).not.toHaveBeenCalled();
  });

  it("does not evict-all for a brand new oauth connector, since no live session could reference it yet", async () => {
    const oauthEntry = { title: "Linear", transport: "http", url: "https://linear.example/mcp", groups: ["eng"], auth: "oauth", oauthClientId: "client-1" };
    const response = await POST(post({ verb: "upsert", slug: "linear", entry: oauthEntry }));

    expect(response.status).toBe(200);
    expect(evictAllWarmSessionsMock).not.toHaveBeenCalled();
  });
});
