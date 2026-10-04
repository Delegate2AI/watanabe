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
const { getCredential } = await import("@/lib/db/connector-credentials");
const { sealOauthConfigSnapshot } = await import("@/lib/connectors/oauth-config-snapshot");

const ALICE = { email: "alice@example.com", name: "Alice" };
const BOB = { email: "bob@example.com", name: "Bob" };

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

function seedState(overrides: Partial<Parameters<typeof createState>[1]> = {}): string {
  const now = new Date();
  const callerEmail = overrides.callerEmail ?? ALICE.email;
  return createState(db, {
    callerEmail,
    connectorSlug: "linear",
    verifier: "a".repeat(43),
    fingerprint: OAUTH_CONFIG.fingerprint,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    configSnapshot: sealOauthConfigSnapshot(LINEAR_ENTRY, OAUTH_CONFIG, {
      email: callerEmail,
      slug: "linear",
      fingerprint: OAUTH_CONFIG.fingerprint,
    })!,
    ...overrides,
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

describe("GET /api/connectors/oauth/callback", () => {
  it("answers not_found when the flag is off, before touching identity", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);
    const res = await GET(callback({ state: "s", code: "c" }));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("redirects to the error page without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await GET(callback({ state: "s", code: "c" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
  });

  it("redirects to the error page when state or code is missing", async () => {
    const res = await GET(callback({ state: "s" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
  });

  it("refuses an unknown state, with no token exchange attempted", async () => {
    const res = await GET(callback({ state: "does-not-exist", code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses an expired state, with no token exchange attempted", async () => {
    const now = new Date();
    const state = seedState({ expiresAt: new Date(now.getTime() - 1000).toISOString() });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses a reused (already consumed) state", async () => {
    const state = seedState();
    const first = await GET(callback({ state, code: "auth-code" }));
    expect(first.headers.get("location")).toBe("/connectors?connected=linear");
    exchangeAuthorizationCodeMock.mockClear();

    const second = await GET(callback({ state, code: "auth-code" }));
    expect(second.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses when the state's caller does not match the authenticated identity", async () => {
    const state = seedState({ callerEmail: BOB.email });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses when the caller's clearance for the slug was revoked before the callback, storing nothing and attempting no exchange", async () => {
    const state = seedState();
    findClearedConnectorEntryMock.mockReturnValue(undefined);
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(findClearedConnectorEntryMock).toHaveBeenCalledWith("linear", ALICE.email);
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
    expect(getCredential(db, ALICE.email, "linear")).toBeNull();
  });

  it("refuses before any metadata reverification when the credential sealing key is absent", async () => {
    const state = seedState();
    const saved = process.env.CONNECTOR_CRED_KEY;
    delete process.env.CONNECTOR_CRED_KEY;
    try {
      const res = await GET(callback({ state, code: "auth-code" }));
      expect(res.headers.get("location")).toBe("/connectors?error=oauth");
      expect(reverifyOauthConfigMock).not.toHaveBeenCalled();
      expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
      expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
    } finally {
      process.env.CONNECTOR_CRED_KEY = saved;
    }
  });

  it("refuses when the state's sealed config snapshot cannot be parsed, with no token exchange attempted", async () => {
    const state = seedState({ configSnapshot: "not-a-sealed-value" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses when the registry entry's url has drifted since connect, with no token exchange attempted", async () => {
    const state = seedState();
    findClearedConnectorEntryMock.mockReturnValue({ ...LINEAR_ENTRY, url: "https://attacker.example.com/mcp" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses when the registry entry's oauthClientId has drifted since connect, with no token exchange attempted", async () => {
    const state = seedState();
    findClearedConnectorEntryMock.mockReturnValue({ ...LINEAR_ENTRY, oauthClientId: "new-client" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(exchangeAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("refuses when the token exchange fails, without evicting the caller's warm sessions", async () => {
    const state = seedState();
    exchangeAuthorizationCodeMock.mockResolvedValue({ ok: false, reason: "invalid_grant" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(getCredential(db, ALICE.email, "linear")).toBeNull();
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("does not evict on an unknown state, before any identity or db work matters", async () => {
    const res = await GET(callback({ state: "does-not-exist", code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("does not evict when the callback is refused for registry drift", async () => {
    const state = seedState();
    findClearedConnectorEntryMock.mockReturnValue({ ...LINEAR_ENTRY, url: "https://attacker.example.com/mcp" });
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.headers.get("location")).toBe("/connectors?error=oauth");
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("exchanges the code with the stored pkce verifier and the same redirect uri, from the sealed snapshot's config", async () => {
    const state = seedState({ verifier: "verifier-value-1234567890123456789012" });
    await GET(callback({ state, code: "auth-code" }));
    expect(exchangeAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenEndpoint: OAUTH_CONFIG.tokenEndpoint }),
      { code: "auth-code", verifier: "verifier-value-1234567890123456789012", redirectUri: REDIRECT_URI },
    );
  });

  it("stores a sealed credential row on success and redirects to the connected slug", async () => {
    const state = seedState();
    const res = await GET(callback({ state, code: "auth-code" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/connectors?connected=linear");

    const stored = getCredential(db, ALICE.email, "linear");
    expect(stored).not.toBeNull();
    expect(stored?.fingerprint).toBe(OAUTH_CONFIG.fingerprint);
    expect(stored?.ciphertext).not.toContain("secret-access-token");
    expect(stored?.ciphertext).not.toContain("secret-refresh-token");
    expect(stored?.ciphertext).not.toContain(OAUTH_CONFIG.clientSecret);
    const raw = db
      .prepare("SELECT ciphertext FROM connector_credentials WHERE caller_email = ? AND connector_slug = ?")
      .get(ALICE.email, "linear") as { ciphertext: string };
    expect(raw.ciphertext).not.toContain("secret-access-token");
    expect(raw.ciphertext).not.toContain("secret-refresh-token");
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(ALICE.email);
  });

  it("consumes the state before the exchange, so a mid-flight crash cannot leave it replayable", async () => {
    const state = seedState();
    exchangeAuthorizationCodeMock.mockRejectedValue(new Error("boom"));
    await GET(callback({ state, code: "auth-code" }));
    const again = await GET(callback({ state, code: "auth-code" }));
    expect(again.headers.get("location")).toBe("/connectors?error=oauth");
  });
});
