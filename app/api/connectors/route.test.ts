import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const isConnectorsEnabledMock = vi.fn();
const isConnectorOauthEnabledMock = vi.fn();
vi.mock("@/lib/connectors/config", () => ({
  isConnectorsEnabled: () => isConnectorsEnabledMock(),
  isConnectorOauthEnabled: () => isConnectorOauthEnabledMock(),
}));

const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const resolveClearanceForEmailMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (...args: unknown[]) => resolveClearanceForEmailMock(...args),
}));

const listCredentialSlugsMock = vi.fn();
vi.mock("@/lib/db/connector-credentials", () => ({
  listCredentialSlugs: (...args: unknown[]) => listCredentialSlugsMock(...args),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({}),
}));

const { GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

const REGISTRY = {
  entries: [
    { slug: "linear", title: "Linear", transport: "http", url: "https://l.example", groups: ["eng"] },
    { slug: "payroll", title: "Payroll", transport: "http", url: "https://p.example", groups: ["finance"] },
    { slug: "wiki", title: "Wiki", transport: "sse", url: "https://w.example", groups: ["all-hands"] },
  ],
  errors: [],
};

function get(): Request {
  return new Request("http://localhost/api/connectors");
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  isConnectorOauthEnabledMock.mockReset().mockReturnValue(false);
  loadConnectorRegistryMock.mockReset().mockReturnValue(REGISTRY);
  resolveClearanceForEmailMock.mockReset().mockReturnValue(["all-hands", "eng"]);
  listCredentialSlugsMock.mockReset().mockReturnValue([]);
});

describe("GET /api/connectors", () => {
  it("401s without an identity, before touching the registry", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off (dark route), before touching the registry", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    const res = await GET(get());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found" } });
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("lists only the connectors whose groups intersect the caller's clearance", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(resolveClearanceForEmailMock).toHaveBeenCalledWith("alice@example.com");
    expect(await res.json()).toEqual({
      connectors: [
        { slug: "linear", title: "Linear", transport: "http" },
        { slug: "wiki", title: "Wiki", transport: "sse" },
      ],
    });
  });

  it("returns an empty list when the caller is cleared for nothing", async () => {
    resolveClearanceForEmailMock.mockReturnValue(["marketing"]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connectors: [] });
  });

  it("never exposes url, headers, command, env, or groups in the payload", async () => {
    const res = await GET(get());
    const body = (await res.json()) as { connectors: Array<Record<string, unknown>> };
    for (const connector of body.connectors) {
      expect(Object.keys(connector).sort()).toEqual(["slug", "title", "transport"]);
    }
  });

  it("never exposes oauthClientId, oauthClientSecret, or authOrigins, even when the registry entry carries them", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "linear",
          title: "Linear",
          transport: "http",
          url: "https://l.example",
          groups: ["eng"],
          auth: "oauth",
          oauthClientId: "the-client-id",
          oauthClientSecret: "${LINEAR_OAUTH_SECRET}",
          authOrigins: ["https://auth.linear.app"],
        },
      ],
      errors: [],
    });
    const res = await GET(get());
    const body = (await res.json()) as { connectors: Array<Record<string, unknown>> };
    expect(Object.keys(body.connectors[0]).sort()).toEqual(["auth", "slug", "title", "transport"]);
  });

  it("carries auth: oauth on an oauth entry regardless of the oauth flag, without a connected field when the flag is off", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);
    loadConnectorRegistryMock.mockReturnValue({
      entries: [
        { slug: "linear", title: "Linear", transport: "http", url: "https://l.example", groups: ["eng"], auth: "oauth" },
      ],
      errors: [],
    });
    const res = await GET(get());
    expect(await res.json()).toEqual({
      connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth" }],
    });
    expect(listCredentialSlugsMock).not.toHaveBeenCalled();
  });

  it("carries connected: true for an oauth entry the caller already holds a credential for, when the flag is on", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(true);
    listCredentialSlugsMock.mockReturnValue(["linear"]);
    loadConnectorRegistryMock.mockReturnValue({
      entries: [
        { slug: "linear", title: "Linear", transport: "http", url: "https://l.example", groups: ["eng"], auth: "oauth" },
        { slug: "wiki", title: "Wiki", transport: "sse", url: "https://w.example", groups: ["all-hands"] },
      ],
      errors: [],
    });
    const res = await GET(get());
    expect(await res.json()).toEqual({
      connectors: [
        { slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: true },
        { slug: "wiki", title: "Wiki", transport: "sse" },
      ],
    });
    expect(listCredentialSlugsMock).toHaveBeenCalledWith({}, "alice@example.com");
  });

  it("carries connected: false for an oauth entry the caller holds no credential for, when the flag is on", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(true);
    listCredentialSlugsMock.mockReturnValue([]);
    loadConnectorRegistryMock.mockReturnValue({
      entries: [
        { slug: "linear", title: "Linear", transport: "http", url: "https://l.example", groups: ["eng"], auth: "oauth" },
      ],
      errors: [],
    });
    const res = await GET(get());
    expect(await res.json()).toEqual({
      connectors: [{ slug: "linear", title: "Linear", transport: "http", auth: "oauth", connected: false }],
    });
  });

  it("carries description and icon when the registry sets them, omits them when it does not", async () => {
    loadConnectorRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "linear",
          title: "Linear",
          transport: "http",
          url: "https://l.example",
          groups: ["eng"],
          description: "Track issues and pull requests.",
          icon: "chart",
        },
        { slug: "wiki", title: "Wiki", transport: "sse", url: "https://w.example", groups: ["all-hands"] },
      ],
      errors: [],
    });
    const res = await GET(get());
    expect(await res.json()).toEqual({
      connectors: [
        { slug: "linear", title: "Linear", transport: "http", description: "Track issues and pull requests.", icon: "chart" },
        { slug: "wiki", title: "Wiki", transport: "sse" },
      ],
    });
  });
});
