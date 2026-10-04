import { randomBytes } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { getCredential, upsertCredential, deleteCredential } from "@/lib/db/connector-credentials";
import { sealCredential } from "./cred-crypto";

const loadConnectorRegistryMock = vi.fn();
vi.mock("./registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const evictSessionsForOwnerMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: (...args: unknown[]) => evictSessionsForOwnerMock(...args),
}));

const refreshAccessTokenMock = vi.fn();
vi.mock("./oauth-exchange", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./oauth-exchange")>();
  return { ...actual, refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args) };
});

const { resolveOauthBearer } = await import("./oauth-headers");

const CALLER = "alice@example.com";
const SLUG = "linear";

const ENTRY = {
  slug: SLUG,
  title: "Linear",
  transport: "http" as const,
  url: "https://api.example.com/mcp",
  groups: ["eng"],
  auth: "oauth" as const,
  authOrigins: ["https://idp.example.com"],
};

let db: DatabaseType;
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
  vi.stubEnv("CONNECTORS_ENABLED", "1");
  vi.stubEnv("CONNECTOR_OAUTH_ENABLED", "1");
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [ENTRY], errors: [] });
  evictSessionsForOwnerMock.mockReset();
  refreshAccessTokenMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function seal(
  plain: object,
  fingerprint = "fp-1",
): { ciphertext: string; keyId: string } {
  const sealed = sealCredential(plain, { email: CALLER, slug: SLUG, fingerprint });
  expect(sealed).not.toBeNull();
  return sealed!;
}

function storeCredential(
  plain: Record<string, unknown>,
  overrides: { fingerprint?: string; expiresAt?: string | null; withMcpUrl?: boolean } = {},
): void {
  const fingerprint = overrides.fingerprint ?? "fp-1";
  const payload: Record<string, unknown> = { ...plain };
  if (overrides.withMcpUrl !== false && payload.mcpUrl === undefined) payload.mcpUrl = ENTRY.url;
  if (payload.clientSource === undefined) payload.clientSource = "dcr";
  if (overrides.expiresAt) payload.expiresAt = overrides.expiresAt;
  const sealed = seal(payload, fingerprint);
  const now = new Date().toISOString();
  upsertCredential(db, {
    callerEmail: CALLER,
    slug: SLUG,
    fingerprint,
    ciphertext: sealed.ciphertext,
    keyId: sealed.keyId,
    expiresAt: overrides.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

const FAR_FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const EXPIRING_SOON = new Date(Date.now() + 10_000).toISOString();

describe("resolveOauthBearer", () => {
  it("returns an empty map and reads nothing from the db when the flag is off", async () => {
    vi.stubEnv("CONNECTOR_OAUTH_ENABLED", "0");
    storeCredential({
      accessToken: "tok",
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "client-1",
      tokenEndpointAuthMethod: "client_secret_post",
    });
    const prepareSpy = vi.spyOn(db, "prepare");

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.size).toBe(0);
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it("returns the access token for a connected, non-expiring credential", async () => {
    storeCredential(
      {
        accessToken: "tok-live",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: FAR_FUTURE },
    );

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.get(SLUG)?.token).toBe("tok-live");
    expect(result.get(SLUG)?.url).toBe(ENTRY.url);
  });

  it("omits a slug with no stored credential", async () => {
    const result = await resolveOauthBearer(db, CALLER, [SLUG]);
    expect(result.has(SLUG)).toBe(false);
  });

  it("omits an unrefreshable, expiring credential without calling the token endpoint", async () => {
    storeCredential(
      {
        accessToken: "tok-expiring",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: EXPIRING_SOON },
    );

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring credential and stores the replacement", async () => {
    storeCredential(
      {
        accessToken: "tok-old",
        refreshToken: "refresh-old",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: EXPIRING_SOON },
    );
    refreshAccessTokenMock.mockResolvedValue({
      ok: true,
      tokens: { accessToken: "tok-new", refreshToken: "refresh-new", expiresAt: FAR_FUTURE },
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.get(SLUG)?.token).toBe("tok-new");
    const row = getCredential(db, CALLER, SLUG);
    expect(row?.expiresAt).toBe(FAR_FUTURE);
  });

  it("omits the slug and leaves the stored credential untouched when the refresh call fails", async () => {
    storeCredential(
      {
        accessToken: "tok-old",
        refreshToken: "refresh-old",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: EXPIRING_SOON },
    );
    refreshAccessTokenMock.mockResolvedValue({ ok: false, reason: "token endpoint refused the refresh" });
    const before = getCredential(db, CALLER, SLUG);

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    const after = getCredential(db, CALLER, SLUG);
    expect(after?.ciphertext).toBe(before?.ciphertext);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("drops the refreshed token and leaves the row deleted when the credential is disconnected mid-refresh", async () => {
    storeCredential(
      {
        accessToken: "tok-old",
        refreshToken: "refresh-old",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: EXPIRING_SOON },
    );
    refreshAccessTokenMock.mockImplementation(async () => {
      deleteCredential(db, CALLER, SLUG);
      return { ok: true, tokens: { accessToken: "tok-new", expiresAt: FAR_FUTURE } };
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(getCredential(db, CALLER, SLUG)).toBeNull();
  });

  it("drops the refreshed token and keeps the interleaved write when another writer changed the credential mid-refresh", async () => {
    storeCredential(
      {
        accessToken: "tok-old",
        refreshToken: "refresh-old",
        tokenEndpoint: "https://idp.example.com/token",
        clientId: "client-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { expiresAt: EXPIRING_SOON },
    );
    refreshAccessTokenMock.mockImplementation(async () => {
      const now = new Date().toISOString();
      upsertCredential(db, {
        callerEmail: CALLER,
        slug: SLUG,
        fingerprint: "fp-1",
        ciphertext: "interleaved-ciphertext",
        keyId: "v1",
        expiresAt: FAR_FUTURE,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, tokens: { accessToken: "tok-new", expiresAt: FAR_FUTURE } };
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(getCredential(db, CALLER, SLUG)?.ciphertext).toBe("interleaved-ciphertext");
  });

});
