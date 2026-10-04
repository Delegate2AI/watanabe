import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { GET, POST } = await import("./route");

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

function get(): Request {
  return new Request("http://localhost/api/admin/connectors");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/connectors", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeConnectorsMock.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/admin/connectors: the body is capped", () => {
  it("413s a body past the cap instead of buffering whatever arrives", async () => {
    const oversized = { ...UPSERT, entry: { ...UPSERT.entry, title: "x".repeat(70_000) } };

    const response = await POST(post(oversized));

    expect(response.status).toBe(413);
    expect(writeConnectorsMock).not.toHaveBeenCalled();
  });

  it("translates the writer's invalid connector groups refusal to 400", async () => {
    writeConnectorsMock.mockResolvedValue({ ok: false, error: "invalid connector groups" });

    const response = await POST(post(UPSERT));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
  });
});

describe("GET /api/admin/connectors: a loader reason is scrubbed", () => {
  it("replaces the absolute server path a parse error carries", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [],
      errors: [{ slug: "*", reason: "ENOENT: no such file, open /srv/portal/.data/access/connectors.yaml" }],
    });

    const body = (await (await GET(get())).json()) as { entries: Array<{ reason: string }> };

    expect(body.entries[0].reason).not.toContain("/srv/portal");
    expect(body.entries[0].reason).toContain("<path>");
  });
});
