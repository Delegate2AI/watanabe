import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import { log } from "@/lib/log";

const getConfigMock = vi.fn();
vi.mock("@/lib/config", () => ({ getConfig: () => getConfigMock() }));

const oidc: OidcConfig = {
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

const DOC = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let GET: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc } });
  const { resetDiscoveryCacheForTests } = await import("@/lib/auth/oidc/discovery");
  resetDiscoveryCacheForTests();
  const { resetRateLimits } = await import("@/lib/http/rate-limit");
  resetRateLimits();
  ({ GET } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (url = "https://portal.example.com/api/auth/login") => new Request(url);

describe("GET /api/auth/login", () => {
  it("404s in every other auth mode", async () => {
    getConfigMock.mockReturnValue({ auth: { mode: "proxy-header", proxyHeader: {} } });
    expect((await GET(request())).status).toBe(404);
  });

  it("redirects to the provider and sets four transient cookies, __Host--prefixed under this https config", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(DOC)));
    const response = await GET(request());
    expect(response.status).toBe(302);

    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(DOC.authorization_endpoint);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.every((c) => c.includes("HttpOnly") && c.includes("Max-Age=600"))).toBe(true);
    expect(cookies.every((c) => c.startsWith("__Host-"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__Host-portal_oidc_state="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("__Host-portal_oidc_return=%2F"))).toBe(true);
  });

  it("does not prefix the transient cookies under a loopback http baseUrl", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...DOC })));
    getConfigMock.mockReturnValue({
      auth: { mode: "oidc", oidc: { ...oidc, baseUrl: "http://localhost:3100" } },
    });
    const response = await GET(new Request("http://localhost:3100/api/auth/login"));
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.every((c) => !c.startsWith("__Host-"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("portal_oidc_state="))).toBe(true);
  });

  it("parks a safe next path and refuses an unsafe one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(DOC)));
    const ok = await GET(request("https://portal.example.com/api/auth/login?next=/projects/7"));
    expect(
      ok.headers
        .getSetCookie()
        .some(
          (c) =>
            c === `__Host-portal_oidc_return=%2Fprojects%2F7; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
        ),
    ).toBe(true);

    const bad = await GET(request("https://portal.example.com/api/auth/login?next=//evil.example"));
    expect(bad.headers.getSetCookie().some((c) => c.startsWith("__Host-portal_oidc_return=%2F;"))).toBe(true);
  });

  it("sends an unreachable provider to /login with a reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const response = await GET(request());
    expect(response.headers.get("location")).toBe(
      "https://portal.example.com/login?error=provider_unreachable",
    );
  });

  it("rate-limits a caller that starts thirty-one logins in a minute", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(DOC)));
    const headers = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 30; i += 1) {
      const response = await GET(new Request("https://portal.example.com/api/auth/login", { headers }));
      expect(response.status).toBe(302);
    }
    const blocked = await GET(new Request("https://portal.example.com/api/auth/login", { headers }));
    expect(blocked.status).toBe(429);
  });
});
