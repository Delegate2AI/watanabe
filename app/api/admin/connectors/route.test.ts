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

vi.mock("@/lib/db/connector-credentials", () => ({
  listCredentialOwners: () => [],
  deleteCredentialsForSlug: () => {},
}));

vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: () => {},
  evictAllWarmSessions: () => {},
}));

const { GET, POST, dynamic, runtime } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };

const LINEAR = {
  slug: "linear",
  title: "Linear",
  transport: "http",
  url: "https://linear.example/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["eng"],
};

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

const savedEnv = { ...process.env };

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [LINEAR], errors: [] });
  writeConnectorsMock.mockReset().mockResolvedValue({ ok: true });
  process.env.LINEAR_TOKEN = "set";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("GET /api/admin/connectors", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("401s without an identity, before touching the registry", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await GET(get())).status).toBe(401);
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(404);
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("lists healthy entries with env presence and rejected entries as disabled", async () => {
    delete process.env.LINEAR_TOKEN;
    loadConnectorRegistryMock.mockReturnValue({
      entries: [LINEAR],
      errors: [{ slug: "broken", reason: "http/sse need url; stdio needs command" }],
    });

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [
        { slug: "broken", status: "disabled", reason: "http/sse need url; stdio needs command", envVars: [] },
        { ...LINEAR, status: "ok", envVars: [{ name: "LINEAR_TOKEN", present: false }] },
      ],
    });
  });

  it("never returns oauthClientSecret, even when the registry entry carries one", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...LINEAR, auth: "oauth", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }],
      errors: [],
    });

    const body = (await (await GET(get())).json()) as { entries: Array<Record<string, unknown>> };

    expect(Object.keys(body.entries[0])).not.toContain("oauthClientSecret");
  });

  it("renders a file-level parse failure as its own disabled row", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [],
      errors: [{ slug: "*", reason: "Nested mappings are not allowed" }],
    });

    const response = await GET(get());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: [{ slug: "*", status: "disabled", reason: "Nested mappings are not allowed", envVars: [] }],
    });
  });

  it("reports an empty variable as absent, matching what interpolation does", async () => {
    process.env.LINEAR_TOKEN = "";

    const body = (await (await GET(get())).json()) as { entries: Array<{ envVars: unknown }> };

    expect(body.entries[0].envVars).toEqual([{ name: "LINEAR_TOKEN", present: false }]);
  });

  it("reports a referenced variable as present without exposing its value", async () => {
    process.env.LINEAR_TOKEN = "super-secret";

    const body = await (await GET(get())).text();

    expect(body).toContain('"present":true');
    expect(body).not.toContain("super-secret");
  });
});

describe("POST /api/admin/connectors", () => {
  it("401s without an identity, before writing", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(post(UPSERT))).status).toBe(401);
    expect(writeConnectorsMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    expect((await POST(post(UPSERT))).status).toBe(404);
    expect(writeConnectorsMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess, before parsing the body", async () => {
    canMock.mockReturnValue(false);

    const response = await POST(post("not-json"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(writeConnectorsMock).not.toHaveBeenCalled();
  });

  it("writes an upsert and reports success", async () => {
    const response = await POST(post(UPSERT));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(writeConnectorsMock).toHaveBeenCalledWith(UPSERT, "admin@example.com");
  });

  it("writes a remove", async () => {
    const response = await POST(post({ verb: "remove", slug: "linear" }));

    expect(response.status).toBe(200);
    expect(writeConnectorsMock).toHaveBeenCalledWith({ verb: "remove", slug: "linear" }, "admin@example.com");
  });

  it.each([
    ["a reserved slug", "kb"],
    ["a malformed slug", "Legacy-Thing"],
    ["a prototype key", "constructor"],
  ])("lets a remove of %s reach the writer, so a hand-seeded row stays deletable", async (_label, slug) => {
    const response = await POST(post({ verb: "remove", slug }));

    expect(response.status).toBe(200);
    expect(writeConnectorsMock).toHaveBeenCalledWith({ verb: "remove", slug }, "admin@example.com");
  });

  it("404s a remove the writer says the file does not carry", async () => {
    writeConnectorsMock.mockResolvedValue({ ok: false, error: "unknown connector" });

    expect((await POST(post({ verb: "remove", slug: "kb" }))).status).toBe(404);
  });

  it.each([
    ["a body that is not json", "not-json"],
    ["an unknown verb", { verb: "rename", slug: "linear" }],
    ["an upsert of a reserved slug", { ...UPSERT, slug: "kb" }],
    ["an upsert of a slug that is not a slug", { ...UPSERT, slug: "Not A Slug" }],
    ["a remove with an empty slug", { verb: "remove", slug: "" }],
    ["an http entry with no url", { verb: "upsert", slug: "linear", entry: { title: "L", transport: "http", groups: ["eng"] } }],
    ["an entry with an unknown field", { verb: "upsert", slug: "linear", entry: { ...UPSERT.entry, nope: 1 } }],
    ["an entry with no groups", { verb: "upsert", slug: "linear", entry: { title: "L", transport: "http", url: "https://l.example" } }],
  ])("rejects %s with 400 and never writes", async (_label, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(writeConnectorsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403, "needs_role"],
    ["unknown connector", 404, "not_found"],
    ["invalid connector entry", 400, "invalid_request"],
    ["connector configuration failed validation", 400, "invalid_request"],
    ["fatal: could not read from remote", 500, "internal"],
  ])("translates the writer's %s refusal to %i", async (error, status, code) => {
    writeConnectorsMock.mockResolvedValue({ ok: false, error });

    const response = await POST(post(UPSERT));

    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("never echoes a commit failure message into the body", async () => {
    writeConnectorsMock.mockResolvedValue({ ok: false, error: "fatal: https://oauth2:glpat-xxx@gitlab.example" });

    const body = await (await POST(post(UPSERT))).text();

    expect(body).not.toContain("glpat-xxx");
  });
});
