import { randomBytes } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { deleteCredential, upsertCredential } from "@/lib/db/connector-credentials";
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
const SLUG_B = "github";

const ENTRY = {
  slug: SLUG,
  title: "Linear",
  transport: "http" as const,
  url: "https://api.example.com/mcp",
  groups: ["eng"],
  auth: "oauth" as const,
  authOrigins: ["https://idp.example.com"],
};

const ENTRY_B = { ...ENTRY, slug: SLUG_B, url: "https://api.github.example.com/mcp" };

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
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [ENTRY, ENTRY_B], errors: [] });
  evictSessionsForOwnerMock.mockReset();
  refreshAccessTokenMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function storeCredential(
  slug: string,
  plain: Record<string, unknown>,
  overrides: { fingerprint?: string; expiresAt?: string | null; mcpUrl?: string } = {},
): void {
  const fingerprint = overrides.fingerprint ?? "fp-1";
  const payload: Record<string, unknown> = { ...plain };
  if (payload.mcpUrl === undefined) payload.mcpUrl = overrides.mcpUrl ?? ENTRY.url;
  if (payload.clientSource === undefined) payload.clientSource = "dcr";
  if (overrides.expiresAt) payload.expiresAt = overrides.expiresAt;
  const sealed = sealCredential(payload, { email: CALLER, slug, fingerprint });
  expect(sealed).not.toBeNull();
  const now = new Date().toISOString();
  upsertCredential(db, {
    callerEmail: CALLER,
    slug,
    fingerprint,
    ciphertext: sealed!.ciphertext,
    keyId: sealed!.keyId,
    expiresAt: overrides.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

const FAR_FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const EXPIRING_SOON = new Date(Date.now() + 10_000).toISOString();

describe("resolveOauthBearer concurrency", () => {
  it("shares one in-flight refresh across two concurrent resolves for the same caller and slug", async () => {
    storeCredential(SLUG, {
      accessToken: "tok-old",
      refreshToken: "refresh-old",
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "client-1",
      tokenEndpointAuthMethod: "client_secret_post",
    }, { expiresAt: EXPIRING_SOON });
    let resolveRefresh: (value: unknown) => void = () => {};
    refreshAccessTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const first = resolveOauthBearer(db, CALLER, [SLUG]);
    const second = resolveOauthBearer(db, CALLER, [SLUG]);
    resolveRefresh({ ok: true, tokens: { accessToken: "tok-new", expiresAt: FAR_FUTURE } });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(firstResult.get(SLUG)?.token).toBe("tok-new");
    expect(secondResult.get(SLUG)?.token).toBe("tok-new");
  });

  it("drops an already-resolved bearer whose credential is disconnected while a later slug in the same request is still refreshing", async () => {
    storeCredential(SLUG, {
      accessToken: "tok-a",
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "client-1",
      tokenEndpointAuthMethod: "client_secret_post",
    }, { expiresAt: FAR_FUTURE });
    storeCredential(SLUG_B, {
      accessToken: "tok-b-old",
      refreshToken: "refresh-b",
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "client-1",
      tokenEndpointAuthMethod: "client_secret_post",
    }, { expiresAt: EXPIRING_SOON, mcpUrl: ENTRY_B.url });
    refreshAccessTokenMock.mockImplementation(async () => {
      deleteCredential(db, CALLER, SLUG);
      return { ok: true, tokens: { accessToken: "tok-b-new", expiresAt: FAR_FUTURE } };
    });

    const result = await resolveOauthBearer(db, CALLER, [SLUG, SLUG_B]);

    expect(result.has(SLUG)).toBe(false);
    expect(result.get(SLUG_B)?.token).toBe("tok-b-new");
  });
});
