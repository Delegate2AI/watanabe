import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oauthEntryMatchesSnapshot, openOauthConfigSnapshot, sealOauthConfigSnapshot } from "./oauth-config-snapshot";
import type { OauthConfig } from "./oauth-discovery";
import type { ConnectorEntry } from "./types";

const ENTRY: ConnectorEntry = {
  slug: "linear",
  title: "Linear",
  transport: "http",
  url: "https://api.example.com/mcp",
  groups: ["eng"],
  auth: "oauth",
  oauthClientId: "client-1",
  authOrigins: ["https://auth.example.com"],
};

const CONFIG: OauthConfig = {
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  clientId: "client-1",
  clientSecret: "secret-1",
  tokenEndpointAuthMethod: "client_secret_post",
  resource: "https://api.example.com/mcp",
  fingerprint: "fp-abc",
};

const AAD = { email: "alice@example.com", slug: "linear", fingerprint: CONFIG.fingerprint };

let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.CONNECTOR_CRED_KEY;
  process.env.CONNECTOR_CRED_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.CONNECTOR_CRED_KEY;
  else process.env.CONNECTOR_CRED_KEY = savedKey;
});

describe("sealOauthConfigSnapshot / openOauthConfigSnapshot", () => {
  it("round trips the config and entry snapshot", () => {
    const sealed = sealOauthConfigSnapshot(ENTRY, CONFIG, AAD);
    expect(sealed).not.toBeNull();
    const opened = openOauthConfigSnapshot(sealed!, AAD);
    expect(opened?.config).toEqual(CONFIG);
    expect(opened?.entry).toEqual({
      url: ENTRY.url,
      auth: ENTRY.auth,
      oauthClientId: ENTRY.oauthClientId,
      authOrigins: ENTRY.authOrigins,
    });
  });

  it("never places a readable copy of the client secret in the sealed string", () => {
    const sealed = sealOauthConfigSnapshot(ENTRY, CONFIG, AAD);
    expect(sealed).not.toBeNull();
    expect(sealed).not.toContain(CONFIG.clientSecret);
  });

  it("returns null when the key is not configured", () => {
    const saved = process.env.CONNECTOR_CRED_KEY;
    delete process.env.CONNECTOR_CRED_KEY;
    try {
      expect(sealOauthConfigSnapshot(ENTRY, CONFIG, AAD)).toBeNull();
    } finally {
      process.env.CONNECTOR_CRED_KEY = saved;
    }
  });

  it("refuses to open with the wrong aad", () => {
    const sealed = sealOauthConfigSnapshot(ENTRY, CONFIG, AAD);
    expect(sealed).not.toBeNull();
    expect(openOauthConfigSnapshot(sealed!, { ...AAD, email: "mallory@example.com" })).toBeNull();
  });

  it("returns null for malformed ciphertext", () => {
    expect(openOauthConfigSnapshot("not-a-sealed-value", AAD)).toBeNull();
  });
});

describe("oauthEntryMatchesSnapshot", () => {
  const snapshotEntry = { url: ENTRY.url!, auth: ENTRY.auth!, oauthClientId: ENTRY.oauthClientId, authOrigins: ENTRY.authOrigins };

  it("matches an unchanged entry", () => {
    expect(oauthEntryMatchesSnapshot(ENTRY, snapshotEntry)).toBe(true);
  });

  it("refuses when the url has drifted", () => {
    expect(oauthEntryMatchesSnapshot({ ...ENTRY, url: "https://attacker.example.com/mcp" }, snapshotEntry)).toBe(false);
  });

  it("refuses when the oauthClientId has drifted", () => {
    expect(oauthEntryMatchesSnapshot({ ...ENTRY, oauthClientId: "new-client" }, snapshotEntry)).toBe(false);
  });

  it("refuses when authOrigins has drifted", () => {
    expect(oauthEntryMatchesSnapshot({ ...ENTRY, authOrigins: ["https://other.example.com"] }, snapshotEntry)).toBe(false);
  });

  it("is order insensitive for authOrigins", () => {
    const entry = { ...ENTRY, authOrigins: ["https://b.example.com", "https://a.example.com"] };
    const snapshot = { ...snapshotEntry, authOrigins: ["https://a.example.com", "https://b.example.com"] };
    expect(oauthEntryMatchesSnapshot(entry, snapshot)).toBe(true);
  });

  it("refuses when auth has drifted", () => {
    expect(oauthEntryMatchesSnapshot({ ...ENTRY, auth: undefined }, snapshotEntry)).toBe(false);
  });
});
