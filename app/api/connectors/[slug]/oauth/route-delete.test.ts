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

const revokeCredentialTokensMock = vi.fn();
vi.mock("@/lib/connectors/oauth-exchange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/oauth-exchange")>();
  return {
    ...actual,
    revokeCredentialTokens: (...args: unknown[]) => revokeCredentialTokensMock(...args),
  };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const evictSessionsForOwnerMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: (...args: unknown[]) => evictSessionsForOwnerMock(...args),
}));

const { DELETE } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { upsertCredential, getCredential } = await import("@/lib/db/connector-credentials");
const { sealCredential } = await import("@/lib/connectors/cred-crypto");

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
  tokenEndpoint: "https://idp.example.com/token",
  revocationEndpoint: "https://idp.example.com/revoke",
  clientId: "client-1",
  clientSecret: "secret-1",
  tokenEndpointAuthMethod: "client_secret_post" as const,
  fingerprint: "fp-abc123",
};

function del(slug: string): Request {
  return new Request(`http://t/api/connectors/${slug}/oauth`, { method: "DELETE" });
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
  revokeCredentialTokensMock.mockReset().mockResolvedValue({ ok: true });
  evictSessionsForOwnerMock.mockReset();
});

describe("DELETE /api/connectors/[slug]/oauth", () => {
  it("404s when CONNECTOR_OAUTH_ENABLED is off", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);
    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(401);
  });

  it("404s for a slug the caller is not cleared for", async () => {
    findClearedConnectorEntryMock.mockReturnValue(undefined);
    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(404);
  });

  it("returns disconnected true when there is no stored credential, without attempting revocation", async () => {
    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(revokeCredentialTokensMock).not.toHaveBeenCalled();
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("revokes then deletes the stored credential", async () => {
    const sealed = sealCredential(
      {
        accessToken: "tok",
        refreshToken: "rtok",
        tokenEndpoint: OAUTH_CONFIG.tokenEndpoint,
        revocationEndpoint: OAUTH_CONFIG.revocationEndpoint,
        clientId: OAUTH_CONFIG.clientId,
        clientSecret: OAUTH_CONFIG.clientSecret,
        tokenEndpointAuthMethod: OAUTH_CONFIG.tokenEndpointAuthMethod,
      },
      { email: ALICE.email, slug: "linear", fingerprint: OAUTH_CONFIG.fingerprint },
    );
    expect(sealed).not.toBeNull();
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: ALICE.email,
      slug: "linear",
      fingerprint: OAUTH_CONFIG.fingerprint,
      ciphertext: sealed!.ciphertext,
      keyId: sealed!.keyId,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(revokeCredentialTokensMock).toHaveBeenCalledTimes(1);
    expect(getCredential(db, ALICE.email, "linear")).toBeNull();
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(ALICE.email);
  });

  it("still deletes the credential and returns ok when revocation errors", async () => {
    revokeCredentialTokensMock.mockRejectedValue(new Error("revocation endpoint unreachable"));
    const sealed = sealCredential(
      {
        accessToken: "tok",
        tokenEndpoint: OAUTH_CONFIG.tokenEndpoint,
        revocationEndpoint: OAUTH_CONFIG.revocationEndpoint,
        clientId: OAUTH_CONFIG.clientId,
        clientSecret: OAUTH_CONFIG.clientSecret,
        tokenEndpointAuthMethod: OAUTH_CONFIG.tokenEndpointAuthMethod,
      },
      { email: ALICE.email, slug: "linear", fingerprint: OAUTH_CONFIG.fingerprint },
    );
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: ALICE.email,
      slug: "linear",
      fingerprint: OAUTH_CONFIG.fingerprint,
      ciphertext: sealed!.ciphertext,
      keyId: sealed!.keyId,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await DELETE(del("linear"), ctx("linear"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(getCredential(db, ALICE.email, "linear")).toBeNull();
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(ALICE.email);
  });
});
