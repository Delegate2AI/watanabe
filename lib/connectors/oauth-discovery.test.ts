import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOauthConfig } from "./oauth-discovery";
import { reasonOf, responder } from "./egress-fixtures";
import { asBody, entry, prmBody, REDIRECT_URI, resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

describe("resolveOauthConfig", () => {
  it("walks the full same origin metadata chain with a preconfigured client", async () => {
    vi.stubEnv("LINEAR_OAUTH_SECRET", "shh-secret");
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authorizationEndpoint).toBe("https://api.example.com/authorize");
    expect(result.config.tokenEndpoint).toBe("https://api.example.com/token");
    expect(result.config.revocationEndpoint).toBe("https://api.example.com/revoke");
    expect(result.config.clientId).toBe("preconfigured-id");
    expect(result.config.clientSecret).toBe("shh-secret");
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(result.config.resource).toBe("https://api.example.com/mcp");
    expect(result.config.scopes).toEqual(["read", "write"]);
    expect(result.config.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(calls).toEqual([
      "https://api.example.com/.well-known/oauth-protected-resource/mcp",
      "https://api.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("falls back to the bare well known path when the path aware lookup fails", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "https://api.example.com/.well-known/oauth-protected-resource/mcp",
      "https://api.example.com/.well-known/oauth-protected-resource",
      "https://api.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("refuses a cross origin authorization server when the connector has no approved origins", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://other.example.com"),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("approved");
    expect(calls).not.toContain("https://other.example.com/.well-known/oauth-authorization-server");
  });

  it("admits a cross origin authorization server that is listed in authOrigins", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://approved.example.com"),
      "https://approved.example.com/.well-known/oauth-authorization-server": asBody("https://approved.example.com"),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", authOrigins: ["https://approved.example.com"] }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authorizationEndpoint).toBe("https://approved.example.com/authorize");
  });

  it("picks the first authorization server candidate with an approved origin", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody([
        "https://other.example.com",
        "https://api.example.com",
      ]),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authorizationEndpoint).toBe("https://api.example.com/authorize");
  });

  it("changes the fingerprint when the token endpoint changes", async () => {
    const first = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });
    const second = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint: "https://api.example.com/token-v2",
      }),
    });

    const resultA = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: first.impl,
      resolve,
    });
    const resultB = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: second.impl,
      resolve,
    });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.config.fingerprint).not.toBe(resultB.config.fingerprint);
  });

  it("gives the same fingerprint regardless of scope ordering", async () => {
    const first = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com", {
        scopes_supported: ["write", "read"],
      }),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });
    const second = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com", {
        scopes_supported: ["read", "write"],
      }),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });

    const resultA = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: first.impl,
      resolve,
    });
    const resultB = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: second.impl,
      resolve,
    });

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.config.fingerprint).toBe(resultB.config.fingerprint);
  });

  it("refuses metadata that points at a private address even when the origin is approved", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://internal.example.com"),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", authOrigins: ["https://internal.example.com"] }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).not.toContain("10.0.0.5");
  });

  it("refuses when the authorization server metadata issuer does not match the requested issuer", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://other.example.com"),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("issuer");
  });

  it("refuses an authorization endpoint whose origin is not approved", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        authorization_endpoint: "https://other.example.com/authorize",
      }),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("authorization endpoint");
  });

  it("refuses a non https token endpoint", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint: "http://api.example.com/token",
      }),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("https");
  });
});
