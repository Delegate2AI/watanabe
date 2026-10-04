import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOauthConfig } from "./oauth-discovery";
import { reasonOf, responder } from "./egress-fixtures";
import { asBody, entry, prmBody, REDIRECT_URI, resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

describe("resolveOauthConfig preconfigured client auth method", () => {
  it("picks client_secret_basic for a preconfigured secret client when the auth server lists it and not post", async () => {
    vi.stubEnv("LINEAR_OAUTH_SECRET", "shh-secret");
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      }),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_basic");
  });

  it("prefers client_secret_post for a preconfigured secret client when the auth server lists both", async () => {
    vi.stubEnv("LINEAR_OAUTH_SECRET", "shh-secret");
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      }),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_post");
  });

  it("defaults to client_secret_basic for a preconfigured secret client when the auth server is silent on the field", async () => {
    vi.stubEnv("LINEAR_OAUTH_SECRET", "shh-secret");
    const { impl } = responder({
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
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_basic");
  });

  it("refuses a preconfigured secret client when the auth server lists neither recognized method", async () => {
    vi.stubEnv("LINEAR_OAUTH_SECRET", "shh-secret");
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      }),
    });

    const result = await resolveOauthConfig(
      entry({ oauthClientId: "preconfigured-id", oauthClientSecret: "${LINEAR_OAUTH_SECRET}" }),
      REDIRECT_URI,
      { fetchImpl: impl, resolve },
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("auth method");
  });
});
