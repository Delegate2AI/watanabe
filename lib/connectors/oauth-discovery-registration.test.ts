import { afterEach, describe, expect, it } from "vitest";
import { resolveOauthConfig } from "./oauth-discovery";
import { reasonOf, responder } from "./egress-fixtures";
import { asBody, entry, prmBody, REDIRECT_URI, resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  resolve.mockClear();
});

describe("resolveOauthConfig dynamic client registration", () => {
  it("registers a dynamic client and carries redirect uris and the returned auth method", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        registration_endpoint: "https://api.example.com/register",
      }),
      "https://api.example.com/register": () =>
        new Response(
          JSON.stringify({
            client_id: "dcr-client-id",
            client_secret: "dcr-client-secret",
            token_endpoint_auth_method: "client_secret_basic",
          }),
          { status: 201 },
        ),
    });

    const result = await resolveOauthConfig(entry(), REDIRECT_URI, { fetchImpl: impl, resolve });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe("dcr-client-id");
    expect(result.config.clientSecret).toBe("dcr-client-secret");
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_basic");
    expect(calls).toContain("https://api.example.com/register");
    const registrationCall = impl.mock.calls.find(([input]) => input.toString() === "https://api.example.com/register");
    const registrationInit = registrationCall?.[1] as RequestInit;
    expect(registrationInit.method).toBe("POST");
    expect(JSON.parse(registrationInit.body as string).redirect_uris).toEqual([REDIRECT_URI]);
  });

  it("refuses a dynamic client registration response with an unrecognized token endpoint auth method", async () => {
    const { impl } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        registration_endpoint: "https://api.example.com/register",
      }),
      "https://api.example.com/register": () =>
        new Response(
          JSON.stringify({
            client_id: "dcr-client-id",
            client_secret: "dcr-client-secret",
            token_endpoint_auth_method: "private_key_jwt",
          }),
          { status: 201 },
        ),
    });

    const result = await resolveOauthConfig(entry(), REDIRECT_URI, { fetchImpl: impl, resolve });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("auth method");
    expect(reasonOf(result)).not.toContain("dcr-client-secret");
  });

  it("short circuits dynamic client registration when a client id is preconfigured", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/.well-known/oauth-protected-resource/mcp": prmBody("https://api.example.com"),
      "https://api.example.com/.well-known/oauth-authorization-server": asBody("https://api.example.com", {
        registration_endpoint: "https://api.example.com/register",
      }),
    });

    const result = await resolveOauthConfig(entry({ oauthClientId: "preconfigured-id" }), REDIRECT_URI, {
      fetchImpl: impl,
      resolve,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe("preconfigured-id");
    expect(result.config.tokenEndpointAuthMethod).toBe("client_secret_post");
    expect(calls).not.toContain("https://api.example.com/register");
  });
});
