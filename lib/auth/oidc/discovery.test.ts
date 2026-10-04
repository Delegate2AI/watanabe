import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { discover, jwksFor, resetDiscoveryCacheForTests } from "./discovery";
import { log } from "@/lib/log";

const ISSUER = "https://idp.example.com";
const DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  resetDiscoveryCacheForTests();
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("discover", () => {
  it("reads the well-known document", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC));
    vi.stubGlobal("fetch", fetchMock);
    const out = await discover(ISSUER, AbortSignal.timeout(1000));
    expect(out).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/jwks`,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it("caches per issuer, so a second call does not refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC));
    vi.stubGlobal("fetch", fetchMock);
    await discover(ISSUER, AbortSignal.timeout(1000));
    await discover(ISSUER, AbortSignal.timeout(1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates a trailing slash on the issuer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DOC));
    vi.stubGlobal("fetch", fetchMock);
    await discover(`${ISSUER}/`, AbortSignal.timeout(1000));
    expect(fetchMock.mock.calls[0][0]).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it("returns null when the document names a different issuer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ...DOC, issuer: "https://evil.example" })));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();
  });

  it("returns null on a non-ok response, a malformed document, and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();

    resetDiscoveryCacheForTests();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ issuer: ISSUER })));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();

    resetDiscoveryCacheForTests();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();
  });

  it("accepts a document whose endpoints are all https", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(DOC)));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).not.toBeNull();
  });

  it("rejects a document with a non-loopback http endpoint", async () => {
    const insecure = { ...DOC, token_endpoint: "http://idp.example.com/token" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(insecure)));
    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();
  });

  it("passes redirect: manual and does not follow a redirecting discovery response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: `${ISSUER}/.well-known/openid-configuration-elsewhere` },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await discover(ISSUER, AbortSignal.timeout(1000))).toBeNull();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("accepts a loopback http endpoint, for local development", async () => {
    const LOCAL_ISSUER = "http://localhost:9000";
    const localDoc = {
      issuer: LOCAL_ISSUER,
      authorization_endpoint: `${LOCAL_ISSUER}/authorize`,
      token_endpoint: `${LOCAL_ISSUER}/token`,
      jwks_uri: `${LOCAL_ISSUER}/jwks`,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(localDoc)));
    expect(await discover(LOCAL_ISSUER, AbortSignal.timeout(1000))).toEqual({
      issuer: LOCAL_ISSUER,
      authorizationEndpoint: `${LOCAL_ISSUER}/authorize`,
      tokenEndpoint: `${LOCAL_ISSUER}/token`,
      jwksUri: `${LOCAL_ISSUER}/jwks`,
    });
  });
});

describe("jwksFor", () => {
  const endpoints = {
    issuer: ISSUER,
    authorizationEndpoint: `${ISSUER}/authorize`,
    tokenEndpoint: `${ISSUER}/token`,
    jwksUri: `${ISSUER}/jwks`,
  };

  const endpointsDifferentJwks = {
    issuer: "https://other.example.com",
    authorizationEndpoint: "https://other.example.com/authorize",
    tokenEndpoint: "https://other.example.com/token",
    jwksUri: "https://other.example.com/jwks",
  };

  it("caches JWKS sets so a second call returns the identical instance", () => {
    const first = jwksFor(endpoints);
    const second = jwksFor(endpoints);
    expect(first).toBe(second);
  });

  it("returns a different instance for a different jwksUri", () => {
    const first = jwksFor(endpoints);
    const second = jwksFor(endpointsDifferentJwks);
    expect(first).not.toBe(second);
  });

  it("returns a fresh instance after resetDiscoveryCacheForTests clears the cache", () => {
    const first = jwksFor(endpoints);
    resetDiscoveryCacheForTests();
    const second = jwksFor(endpoints);
    expect(first).not.toBe(second);
  });
});
