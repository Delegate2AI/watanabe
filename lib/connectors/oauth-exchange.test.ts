import { describe, it, expect, vi, afterEach } from "vitest";
import { resolve } from "./oauth-discovery-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

const { exchangeAuthorizationCode, refreshAccessToken, parseSealedCredential } = await import("./oauth-exchange");

type Captured = { url: string; init: RequestInit };

function capture(body: unknown = { access_token: "tok", refresh_token: "rtok", expires_in: 3600, token_type: "Bearer" }) {
  const calls: Captured[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl, calls };
}

const BASE_CONFIG = {
  tokenEndpoint: "https://api.example.com/token",
  clientId: "client-1",
  clientSecret: "secret-1",
  tokenEndpointAuthMethod: "client_secret_post" as const,
};

describe("exchangeAuthorizationCode", () => {
  it("posts client_secret_post credentials in the body, never in a header", async () => {
    const { impl, calls } = capture();
    const result = await exchangeAuthorizationCode(
      BASE_CONFIG,
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://portal.example.com/api/connectors/oauth/callback" },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [{ init }] = calls;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("secret-1");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-value");
    expect(body.get("redirect_uri")).toBe("https://portal.example.com/api/connectors/oauth/callback");
  });

  it("sends client_secret_basic credentials only in the authorization header", async () => {
    const { impl, calls } = capture();
    await exchangeAuthorizationCode(
      { ...BASE_CONFIG, tokenEndpointAuthMethod: "client_secret_basic" },
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("client-1:secret-1").toString("base64")}`);
    const body = new URLSearchParams(init.body as string);
    expect(body.has("client_secret")).toBe(false);
  });

  it("form-encodes a client_secret_basic secret containing ':' and '%' before base64ing it", async () => {
    const { impl, calls } = capture();
    const clientSecret = "sec:ret%value";
    await exchangeAuthorizationCode(
      { ...BASE_CONFIG, tokenEndpointAuthMethod: "client_secret_basic", clientSecret },
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const headers = init.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from(
      `${encodeURIComponent(BASE_CONFIG.clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString("base64")}`;
    expect(headers.authorization).toBe(expected);
    expect(headers.authorization).not.toBe(`Basic ${Buffer.from(`${BASE_CONFIG.clientId}:${clientSecret}`).toString("base64")}`);
  });

  it("sends no secret at all for a public client", async () => {
    const { impl, calls } = capture();
    await exchangeAuthorizationCode(
      { ...BASE_CONFIG, tokenEndpointAuthMethod: "none", clientSecret: undefined },
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = new URLSearchParams(init.body as string);
    expect(body.has("client_secret")).toBe(false);
    expect(body.get("client_id")).toBe("client-1");
  });

  it("computes an absolute expiry from expires_in", async () => {
    const { impl } = capture();
    const before = Date.now();
    const result = await exchangeAuthorizationCode(
      BASE_CONFIG,
      { code: "c", verifier: "v", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens.accessToken).toBe("tok");
    expect(result.tokens.refreshToken).toBe("rtok");
    expect(new Date(result.tokens.expiresAt as string).getTime()).toBeGreaterThanOrEqual(before + 3600_000);
  });

  it("includes the resource parameter in the authorization code exchange body when configured", async () => {
    const { impl, calls } = capture();
    await exchangeAuthorizationCode(
      { ...BASE_CONFIG, resource: "https://api.example.com/mcp" },
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("resource")).toBe("https://api.example.com/mcp");
  });

  it("omits the resource parameter from the authorization code exchange body when not configured", async () => {
    const { impl, calls } = capture();
    await exchangeAuthorizationCode(
      BASE_CONFIG,
      { code: "auth-code", verifier: "verifier-value", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    const [{ init }] = calls;
    const body = new URLSearchParams(init.body as string);
    expect(body.has("resource")).toBe(false);
  });

  it("refuses when the token endpoint returns no access token", async () => {
    const { impl } = capture({ error: "invalid_grant" });
    const result = await exchangeAuthorizationCode(
      BASE_CONFIG,
      { code: "c", verifier: "v", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(false);
  });

  it("refuses when the token endpoint answers with a non 2xx status", async () => {
    const impl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const result = await exchangeAuthorizationCode(
      BASE_CONFIG,
      { code: "c", verifier: "v", redirectUri: "https://x.example.com" },
      { fetchImpl: impl, resolve },
    );
    expect(result.ok).toBe(false);
  });
});

describe("refreshAccessToken", () => {
  it("includes the resource parameter in the refresh body when configured", async () => {
    const { impl, calls } = capture();
    await refreshAccessToken({ ...BASE_CONFIG, resource: "https://api.example.com/mcp" }, "refresh-tok", {
      fetchImpl: impl,
      resolve,
    });
    const [{ init }] = calls;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("resource")).toBe("https://api.example.com/mcp");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-tok");
  });

  it("omits the resource parameter from the refresh body when not configured", async () => {
    const { impl, calls } = capture();
    await refreshAccessToken(BASE_CONFIG, "refresh-tok", { fetchImpl: impl, resolve });
    const [{ init }] = calls;
    const body = new URLSearchParams(init.body as string);
    expect(body.has("resource")).toBe(false);
  });
});

describe("parseSealedCredential", () => {
  const VALID = {
    accessToken: "tok",
    refreshToken: "rtok",
    expiresAt: "2026-01-01T00:00:00.000Z",
    tokenEndpoint: "https://api.example.com/token",
    revocationEndpoint: "https://api.example.com/revoke",
    clientId: "client-1",
    clientSecret: "secret-1",
    tokenEndpointAuthMethod: "client_secret_post",
  };

  it("accepts a fully populated sealed credential", () => {
    expect(parseSealedCredential(VALID)).toEqual(VALID);
  });

  it("rejects a payload missing the access token", () => {
    const rest = Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== "accessToken"));
    expect(parseSealedCredential(rest)).toBeNull();
  });

  it("rejects a payload with an unrecognized auth method", () => {
    expect(parseSealedCredential({ ...VALID, tokenEndpointAuthMethod: "bogus" })).toBeNull();
  });

  it("rejects a non object value", () => {
    expect(parseSealedCredential("nope")).toBeNull();
    expect(parseSealedCredential(null)).toBeNull();
  });

  it("carries the resource forward when present", () => {
    expect(parseSealedCredential({ ...VALID, resource: "https://api.example.com/mcp" })?.resource).toBe(
      "https://api.example.com/mcp",
    );
  });
});
