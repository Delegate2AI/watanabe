import { afterEach, describe, expect, it, vi } from "vitest";
import { computeOauthFingerprint, reverifyOauthConfig, type OauthConfig } from "./oauth-discovery";
import { reasonOf, responder } from "./egress-fixtures";
import { asBody, entry, prmBody, resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

const STORED_CLIENT: OauthConfig = {
  authorizationEndpoint: "https://api.example.com/authorize",
  tokenEndpoint: "https://api.example.com/token",
  clientId: "preconfigured-id",
  clientSecret: "shh-secret",
  tokenEndpointAuthMethod: "client_secret_basic",
  scopes: ["read", "write"],
  resource: "https://api.example.com/mcp",
  fingerprint: "",
};

function fingerprintFor(overrides: Record<string, unknown> = {}): string {
  return computeOauthFingerprint({
    mcpUrl: "https://api.example.com/mcp",
    issuer: "https://api.example.com/",
    authorizationEndpoint: "https://api.example.com/authorize",
    tokenEndpoint: "https://api.example.com/token",
    clientId: STORED_CLIENT.clientId,
    scopes: STORED_CLIENT.scopes,
    resource: "https://api.example.com/mcp",
    ...overrides,
  });
}

describe("reverifyOauthConfig", () => {
  it("accepts when the fresh metadata reproduces the expected fingerprint, reusing the stored client", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });

    const result = await reverifyOauthConfig(entry({ oauthClientId: "preconfigured-id" }), STORED_CLIENT, fingerprintFor(), {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe("preconfigured-id");
    expect(result.config.clientSecret).toBe("shh-secret");
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(result.config.tokenEndpoint).toBe("https://api.example.com/token");
  });

  it("never calls dynamic client registration, even for a dcr-backed connector", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        registration_endpoint: "https://api.example.com/register",
      }),
    });

    const result = await reverifyOauthConfig(entry(), STORED_CLIENT, fingerprintFor(), { fetchImpl: impl, resolve });

    expect(result.ok).toBe(true);
    expect(calls).not.toContain("https://api.example.com/register");
  });

  it("refuses when the token endpoint drifted since connect", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint: "https://api.example.com/token-v2",
      }),
    });

    const result = await reverifyOauthConfig(entry({ oauthClientId: "preconfigured-id" }), STORED_CLIENT, fingerprintFor(), {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("drifted");
  });

  it("refuses when discovery itself fails", async () => {
    const { impl } = responder({});

    const result = await reverifyOauthConfig(entry({ oauthClientId: "preconfigured-id" }), STORED_CLIENT, fingerprintFor(), {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
  });

  it("refuses a connector with no url", async () => {
    const result = await reverifyOauthConfig({ ...entry(), url: undefined }, STORED_CLIENT, fingerprintFor(), { resolve });
    expect(result.ok).toBe(false);
  });
});
