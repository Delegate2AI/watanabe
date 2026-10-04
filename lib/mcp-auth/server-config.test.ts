import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizationServerConfig, authorizationServerMetadata } from "./server-config";

beforeEach(() => {
  process.env.MCP_PUBLIC_ORIGIN = "https://wb.example.test";
});

afterEach(() => {
  delete process.env.MCP_PUBLIC_ORIGIN;
});

describe("authorizationServerConfig", () => {
  it("derives every endpoint from the one configured origin", () => {
    expect(authorizationServerConfig()).toEqual({
      issuer: "https://wb.example.test",
      resource: "https://wb.example.test/api/mcp",
      authorizationEndpoint: "https://wb.example.test/oauth/authorize",
      tokenEndpoint: "https://wb.example.test/api/oauth/token",
      registrationEndpoint: "https://wb.example.test/api/oauth/register",
    });
  });

  it("tolerates a trailing slash rather than producing a doubled path", () => {
    process.env.MCP_PUBLIC_ORIGIN = "https://wb.example.test/";
    expect(authorizationServerConfig()?.resource).toBe("https://wb.example.test/api/mcp");
  });

  // Configuration that does not parse has to read as unconfigured, never as
  // broken: an unparseable value used to turn every unauthenticated request
  // into a 500.
  it.each([
    ["unset", undefined],
    ["empty", "   "],
    ["not a URL", "wb.example.test"],
    ["plain http off loopback", "http://wb.example.test"],
  ])("is null when the origin is %s", (_label, value) => {
    if (value === undefined) delete process.env.MCP_PUBLIC_ORIGIN;
    else process.env.MCP_PUBLIC_ORIGIN = value;

    expect(authorizationServerConfig()).toBeNull();
  });

  it("allows loopback over http, which is how local development runs", () => {
    process.env.MCP_PUBLIC_ORIGIN = "http://localhost:3100";
    expect(authorizationServerConfig()?.issuer).toBe("http://localhost:3100");
  });

  // Never from the request Host: an issuer taken from an attacker-controllable
  // header is how a token minted for one audience gets spent at another.
  it("takes nothing from a request, so there is no header to poison", () => {
    expect(authorizationServerConfig.length).toBe(0);
  });
});

describe("authorizationServerMetadata", () => {
  it("advertises only the flow this server actually implements", () => {
    expect(authorizationServerMetadata()).toEqual({
      issuer: "https://wb.example.test",
      authorization_endpoint: "https://wb.example.test/oauth/authorize",
      token_endpoint: "https://wb.example.test/api/oauth/token",
      registration_endpoint: "https://wb.example.test/api/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  });

  // S256 only and no secret: both are load-bearing, so both are asserted rather
  // than left to the shape test above.
  it("refuses to advertise plain PKCE or any client authentication method", () => {
    const metadata = authorizationServerMetadata();

    expect(metadata?.code_challenge_methods_supported).not.toContain("plain");
    expect(metadata?.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("is null when the deployment is not configured", () => {
    delete process.env.MCP_PUBLIC_ORIGIN;
    expect(authorizationServerMetadata()).toBeNull();
  });
});
