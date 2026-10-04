import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOauthConfig } from "./oauth-discovery";
import { reasonOf, responder } from "./egress-fixtures";
import { asBody, entry, prmBody, REDIRECT_URI, resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

describe("resolveOauthConfig protected resource metadata resource binding", () => {
  it("refuses protected resource metadata whose resource origin does not match the connector url", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com", {
        resource: "https://evil.example.com/mcp",
      }),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("resource");
  });

  it("changes the fingerprint when the protected resource metadata resource changes", async () => {
    const first = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com", {
        resource: "https://api.example.com/mcp",
      }),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com"),
    });
    const second = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com", {
        resource: "https://api.example.com/mcp-v2",
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
    expect(resultA.config.fingerprint).not.toBe(resultB.config.fingerprint);
  });
});
