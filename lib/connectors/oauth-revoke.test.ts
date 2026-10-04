import { describe, it, expect, vi } from "vitest";
import { resolve } from "./oauth-discovery-fixtures";

const { revokeCredentialTokens } = await import("./oauth-exchange");

type Captured = { url: string; init: RequestInit };

function capture(body: unknown = {}) {
  const calls: Captured[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl, calls };
}

describe("revokeCredentialTokens", () => {
  it("does nothing and reports ok:false when there is no revocation endpoint", async () => {
    const impl = vi.fn();
    const result = await revokeCredentialTokens(
      { accessToken: "tok", tokenEndpoint: "https://api.example.com/token", clientId: "client-1", tokenEndpointAuthMethod: "none" },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("revokes the refresh token over the access token when both are present", async () => {
    const { impl, calls } = capture({});
    const result = await revokeCredentialTokens(
      {
        accessToken: "tok",
        refreshToken: "rtok",
        tokenEndpoint: "https://api.example.com/token",
        revocationEndpoint: "https://api.example.com/revoke",
        clientId: "client-1",
        clientSecret: "secret-1",
        tokenEndpointAuthMethod: "client_secret_post",
      },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [{ init, url }] = calls;
    expect(url).toBe("https://api.example.com/revoke");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("token")).toBe("rtok");
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });

  it("revokes the access token when there is no refresh token", async () => {
    const { impl, calls } = capture({});
    await revokeCredentialTokens(
      {
        accessToken: "tok",
        tokenEndpoint: "https://api.example.com/token",
        revocationEndpoint: "https://api.example.com/revoke",
        clientId: "client-1",
        tokenEndpointAuthMethod: "none",
      },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("token")).toBe("tok");
    expect(body.get("token_type_hint")).toBe("access_token");
  });

  it("never throws when the revocation call itself fails", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await revokeCredentialTokens(
      {
        accessToken: "tok",
        tokenEndpoint: "https://api.example.com/token",
        revocationEndpoint: "https://api.example.com/revoke",
        clientId: "client-1",
        tokenEndpointAuthMethod: "none",
      },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(false);
  });
});
