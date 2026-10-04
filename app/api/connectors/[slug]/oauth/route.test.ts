import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

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

const findClearedConnectorEntryMock = vi.fn();
vi.mock("@/lib/connectors/clearance", () => ({
  findClearedConnectorEntry: (...args: unknown[]) => findClearedConnectorEntryMock(...args),
}));

const resolveOauthConfigMock = vi.fn();
vi.mock("@/lib/connectors/oauth-discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/oauth-discovery")>();
  return {
    ...actual,
    resolveOauthConfig: (...args: unknown[]) => resolveOauthConfigMock(...args),
  };
});

const resolveConnectorRedirectUriMock = vi.fn();
vi.mock("@/lib/connectors/oauth-exchange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/oauth-exchange")>();
  return {
    ...actual,
    resolveConnectorRedirectUri: () => resolveConnectorRedirectUriMock(),
  };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { consumeState } = await import("@/lib/db/connector-oauth-states");
const { openOauthConfigSnapshot } = await import("@/lib/connectors/oauth-config-snapshot");

const ALICE = { email: "alice@example.com", name: "Alice" };

const LINEAR_ENTRY = {
  slug: "linear",
  title: "Linear",
  transport: "http" as const,
  url: "https://api.example.com/mcp",
  groups: ["eng"],
  auth: "oauth" as const,
};

const OAUTH_CONFIG = {
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  revocationEndpoint: "https://idp.example.com/revoke",
  clientId: "client-1",
  clientSecret: "secret-1",
  tokenEndpointAuthMethod: "client_secret_post" as const,
  scopes: ["read", "write"],
  resource: "https://api.example.com/mcp",
  fingerprint: "fp-abc123",
};

const REDIRECT_URI = "https://portal.example.com/api/connectors/oauth/callback";

function post(slug: string): Request {
  return new Request(`http://t/api/connectors/${slug}/oauth`, { method: "POST" });
}

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.CONNECTOR_CRED_KEY;
  process.env.CONNECTOR_CRED_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.CONNECTOR_CRED_KEY;
  else process.env.CONNECTOR_CRED_KEY = savedKey;
});

beforeEach(() => {
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  isConnectorOauthEnabledMock.mockReset().mockReturnValue(true);
  findClearedConnectorEntryMock.mockReset().mockReturnValue(LINEAR_ENTRY);
  resolveOauthConfigMock.mockReset().mockResolvedValue({ ok: true, config: OAUTH_CONFIG });
  resolveConnectorRedirectUriMock.mockReset().mockReturnValue({ ok: true, value: REDIRECT_URI });
});

describe("POST /api/connectors/[slug]/oauth", () => {
  it("404s when CONNECTOR_OAUTH_ENABLED is off, before touching identity", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("404s when CONNECTORS_ENABLED is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(404);
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(401);
  });

  it("404s for an unknown or uncleared slug (no existence oracle)", async () => {
    findClearedConnectorEntryMock.mockReturnValue(undefined);
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(404);
    expect(findClearedConnectorEntryMock).toHaveBeenCalledWith("linear", ALICE.email);
  });

  it("400s for a connector entry that is not auth: oauth", async () => {
    findClearedConnectorEntryMock.mockReturnValue({ ...LINEAR_ENTRY, auth: undefined });
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(400);
    expect(resolveOauthConfigMock).not.toHaveBeenCalled();
  });

  it("returns an authorization redirect with correct pkce and a persisted single use state", async () => {
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(200);
    const { redirect } = (await res.json()) as { redirect: string };
    const url = new URL(redirect);
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe("https://api.example.com/mcp");
    expect(url.searchParams.get("scope")).toBe("read write");

    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    const row = consumeState(db, state as string);
    expect(row).not.toBeNull();
    expect(row?.callerEmail).toBe("alice@example.com");
    expect(row?.connectorSlug).toBe("linear");
    expect(row?.fingerprint).toBe("fp-abc123");
    expect(row?.verifier.length).toBeGreaterThanOrEqual(43);
    expect(row?.verifier.length).toBeLessThanOrEqual(128);

    const snapshot = openOauthConfigSnapshot(row?.configSnapshot ?? "", {
      email: ALICE.email,
      slug: "linear",
      fingerprint: "fp-abc123",
    });
    expect(snapshot?.config.fingerprint).toBe("fp-abc123");
    expect(snapshot?.entry.url).toBe(LINEAR_ENTRY.url);
    expect(snapshot?.entry.auth).toBe("oauth");

    const expectedChallenge = createHash("sha256").update(row?.verifier as string).digest("base64url");
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
  });

  it("returns internal when oauth discovery fails, and never creates a state row", async () => {
    resolveOauthConfigMock.mockResolvedValue({ ok: false, reason: "discovery failed" });
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(500);
    const count = (db.prepare("SELECT COUNT(*) as n FROM connector_oauth_states").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it("refuses before any discovery when the credential sealing key is absent", async () => {
    const saved = process.env.CONNECTOR_CRED_KEY;
    delete process.env.CONNECTOR_CRED_KEY;
    try {
      const res = await POST(post("linear"), ctx("linear"));
      expect(res.status).toBe(503);
      expect(resolveOauthConfigMock).not.toHaveBeenCalled();
      expect(resolveConnectorRedirectUriMock).not.toHaveBeenCalled();
      const count = (db.prepare("SELECT COUNT(*) as n FROM connector_oauth_states").get() as { n: number }).n;
      expect(count).toBe(0);
    } finally {
      process.env.CONNECTOR_CRED_KEY = saved;
    }
  });

  it("sweeps expired state rows on every call", async () => {
    const { createState } = await import("@/lib/db/connector-oauth-states");
    const past = new Date(Date.now() - 1000).toISOString();
    createState(db, {
      callerEmail: ALICE.email,
      connectorSlug: "other",
      verifier: "a".repeat(43),
      fingerprint: "fp-old",
      createdAt: past,
      expiresAt: past,
      configSnapshot: "stale",
    });

    await POST(post("linear"), ctx("linear"));

    const stale = db
      .prepare("SELECT COUNT(*) as n FROM connector_oauth_states WHERE connector_slug = 'other'")
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });

  it("returns internal when the redirect uri cannot be resolved", async () => {
    resolveConnectorRedirectUriMock.mockReturnValue({ ok: false, reason: "no base url" });
    const res = await POST(post("linear"), ctx("linear"));
    expect(res.status).toBe(500);
    expect(resolveOauthConfigMock).not.toHaveBeenCalled();
  });
});
