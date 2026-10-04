import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import { exchangeCode } from "./exchange";
import type { ProviderEndpoints } from "./discovery";
import { log } from "@/lib/log";

const config: OidcConfig = {
  provider: "google",
  clientId: "abc",
  baseUrl: "https://portal.example.com",
  allowedDomains: ["example.com"],
  allowedEmails: [],
  scopes: ["openid", "email", "profile"],
  emailClaim: "email",
  nameClaim: "name",
  cookieName: "portal_session",
  sessionTtlHours: 168,
};

const endpoints: ProviderEndpoints = {
  issuer: "https://accounts.google.com",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
};

const args = {
  endpoints,
  config,
  clientSecret: "shh",
  code: "the-code",
  codeVerifier: "the-verifier",
  signal: AbortSignal.timeout(1000),
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exchangeCode", () => {
  it("posts the form the spec requires and returns the id_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id_token: "tok", access_token: "a", token_type: "Bearer" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode(args)).toBe("tok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(endpoints.tokenEndpoint);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("client_id")).toBe("abc");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("redirect_uri")).toBe("https://portal.example.com/api/auth/callback");
  });

  it("returns null on a rejected exchange", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)));
    expect(await exchangeCode(args)).toBeNull();
  });

  it("returns null when the response carries no id_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ access_token: "a" })));
    expect(await exchangeCode(args)).toBeNull();
  });

  it("returns null on a network failure or timeout rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(exchangeCode(args)).resolves.toBeNull();
  });

  it("passes redirect: manual and does not follow a 302 from the token endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://evil.example/token" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode(args)).toBeNull();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("passes redirect: manual and does not follow a 307 from the token endpoint (the one that would replay the body)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 307, headers: { location: "http://evil.example/token" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeCode(args)).toBeNull();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("never logs the code or the secret", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await exchangeCode(args);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("the-code");
    expect(logged).not.toContain("shh");
  });
});
