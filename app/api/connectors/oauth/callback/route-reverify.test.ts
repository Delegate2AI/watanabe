import { randomBytes } from "node:crypto";
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

const evictSessionsForOwnerMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: (...args: unknown[]) => evictSessionsForOwnerMock(...args),
}));

const reverifyOauthConfigMock = vi.fn();
vi.mock("@/lib/connectors/oauth-discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/oauth-discovery")>();
  return {
    ...actual,
    reverifyOauthConfig: (...args: unknown[]) => reverifyOauthConfigMock(...args),
  };
});

const resolveConnectorRedirectUriMock = vi.fn();
const exchangeAuthorizationCodeMock = vi.fn();
vi.mock("@/lib/connectors/oauth-exchange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/oauth-exchange")>();
  return {
    ...actual,
    resolveConnectorRedirectUri: () => resolveConnectorRedirectUriMock(),
    exchangeAuthorizationCode: (...args: unknown[]) => exchangeAuthorizationCodeMock(...args),
  };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { createState } = await import("@/lib/db/connector-oauth-states");
const { sealOauthConfigSnapshot } = await import("@/lib/connectors/oauth-config-snapshot");

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

function callback(query: Record<string, string>): Request {
  const url = new URL("http://t/api/connectors/oauth/callback");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url);
}

function seedState(): string {
  const now = new Date();
  return createState(db, {
    callerEmail: ALICE.email,
    connectorSlug: "linear",
    verifier: "a".repeat(43),
    fingerprint: OAUTH_CONFIG.fingerprint,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    configSnapshot: sealOauthConfigSnapshot(LINEAR_ENTRY, OAUTH_CONFIG, {
      email: ALICE.email,
      slug: "linear",
      fingerprint: OAUTH_CONFIG.fingerprint,
    })!,
  });
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
  evictSessionsForOwnerMock.mockReset();
  reverifyOauthConfigMock.mockReset().mockResolvedValue({ ok: true, config: OAUTH_CONFIG });
  resolveConnectorRedirectUriMock.mockReset().mockReturnValue({ ok: true, value: REDIRECT_URI });
  exchangeAuthorizationCodeMock.mockReset().mockResolvedValue({
    ok: true,
    tokens: { accessToken: "secret-access-token", refreshToken: "secret-refresh-token", expiresAt: "2030-01-01T00:00:00.000Z" },
  });
});

describe("GET /api/connectors/oauth/callback, authorization server metadata reverification", () => {
  it("refuses when authorization server metadata has drifted since connect, with no token exchange attempted", async () => {
    const state = seedState();
    reverifyOauthConfigMock.mockResolvedValue({ ok: false, reason: "authorization server metadata drifted since connect" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("re-verifies discovery with the stored client, never re-registering one", async () => {
    const state = seedState();
    await GET(callback({ state, code: "auth-code" }));
    expect(reverifyOauthConfigMock).toHaveBeenCalledWith(
      LINEAR_ENTRY,
      expect.objectContaining({ clientId: OAUTH_CONFIG.clientId }),
      OAUTH_CONFIG.fingerprint,
    );
  });

  it("exchanges the code using the reverified config, not the raw stale snapshot", async () => {
    const state = seedState();
    const freshConfig = { ...OAUTH_CONFIG, tokenEndpoint: "https://idp.example.com/token-v2" };
    reverifyOauthConfigMock.mockResolvedValue({ ok: true, config: freshConfig });

    await GET(callback({ state, code: "auth-code" }));

    expect(exchangeAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenEndpoint: "https://idp.example.com/token-v2" }),
      expect.anything(),
    );
  });
});
