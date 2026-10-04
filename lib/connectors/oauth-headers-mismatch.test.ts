import { randomBytes } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { getCredential, upsertCredential } from "@/lib/db/connector-credentials";
import { sealCredential } from "./cred-crypto";

const loadConnectorRegistryMock = vi.fn();
vi.mock("./registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const evictSessionsForOwnerMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictSessionsForOwner: (...args: unknown[]) => evictSessionsForOwnerMock(...args),
}));

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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const FAR_FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function storeCredential(
  plain: Record<string, unknown>,
  overrides: { withMcpUrl?: boolean } = {},
): void {
  const fingerprint = "fp-1";
  const payload: Record<string, unknown> = { ...plain };
  if (overrides.withMcpUrl !== false && payload.mcpUrl === undefined) payload.mcpUrl = ENTRY.url;
  const sealed = sealCredential(payload, { email: CALLER, slug: SLUG, fingerprint });
  expect(sealed).not.toBeNull();
  const now = new Date().toISOString();
  upsertCredential(db, {
    callerEmail: CALLER,
    slug: SLUG,
    fingerprint,
    ciphertext: sealed!.ciphertext,
    keyId: sealed!.keyId,
    expiresAt: FAR_FUTURE,
    createdAt: now,
    updatedAt: now,
  });
}

function credential(clientId = "client-1", clientSource: "preconfigured" | "dcr" = "dcr"): Record<string, unknown> {
  return {
    accessToken: "tok-live",
    tokenEndpoint: "https://idp.example.com/token",
    clientId,
    tokenEndpointAuthMethod: "client_secret_post",
    expiresAt: FAR_FUTURE,
    clientSource,
  };
}

describe("resolveOauthBearer registry drift", () => {
  it("omits, evicts, and does not delete on a registry client-id mismatch", async () => {
    storeCredential(credential("old-client"));
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, oauthClientId: "new-client" }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits and evicts when the entry now has a preconfigured client but the sealed credential is a dcr client", async () => {
    storeCredential(credential("client-1", "dcr"));
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, oauthClientId: "client-1" }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits and evicts when the entry lost its preconfigured client but the sealed credential is a preconfigured client", async () => {
    storeCredential(credential("client-1", "preconfigured"));

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits and evicts when both sides are preconfigured but the client ids differ", async () => {
    storeCredential(credential("old-client", "preconfigured"));
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, oauthClientId: "new-client" }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits and evicts when the sealed credential predates the clientSource field (fail closed)", async () => {
    const payload = credential();
    delete payload.clientSource;
    storeCredential(payload);

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits, evicts, and does not delete when the registry entry's url is retargeted", async () => {
    storeCredential(credential());
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, url: "https://attacker.example.com/mcp" }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("still resolves the bearer when the registry entry's url is unchanged", async () => {
    storeCredential(credential());

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.get(SLUG)?.token).toBe("tok-live");
    expect(evictSessionsForOwnerMock).not.toHaveBeenCalled();
  });

  it("omits and evicts when the sealed token endpoint's origin is no longer within authOrigins", async () => {
    storeCredential(credential());
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, authOrigins: ["https://other-idp.example.com"] }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });

  it("omits and evicts when the sealed revocation endpoint's origin is no longer within authOrigins", async () => {
    storeCredential({ ...credential(), tokenEndpoint: ENTRY.url, revocationEndpoint: "https://idp.example.com/revoke" });
    loadConnectorRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, authOrigins: [] }],
      errors: [],
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
  });

  it("still resolves when the token endpoint's origin is the mcp origin itself, with no authOrigins needed", async () => {
    storeCredential({ ...credential(), tokenEndpoint: `${ENTRY.url}-token` });
    loadConnectorRegistryMock.mockReturnValue({ entries: [{ ...ENTRY, authOrigins: [] }], errors: [] });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.get(SLUG)?.token).toBe("tok-live");
  });

  it("omits, evicts, and does not delete when the sealed credential predates mcpUrl", async () => {
    storeCredential(credential(), { withMcpUrl: false });

    const result = await resolveOauthBearer(db, CALLER, [SLUG]);

    expect(result.has(SLUG)).toBe(false);
    expect(evictSessionsForOwnerMock).toHaveBeenCalledWith(CALLER);
    expect(getCredential(db, CALLER, SLUG)).not.toBeNull();
  });
});
