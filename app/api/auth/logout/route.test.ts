import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";

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

const request = (headers?: HeadersInit) =>
  new Request("https://portal.example.com/api/auth/logout", { method: "POST", headers });

let POST: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc } });
  ({ POST } = await import("./route"));
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and redirects to /login when Origin matches", async () => {
    const response = await POST(request({ origin: "https://portal.example.com" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://portal.example.com/login");
    const cookie = response.headers.getSetCookie()[0] as string;
    // baseUrl is https, so the cookie this route clears carries the __Host-
    // prefix, matching the one the callback route set.
    expect(cookie.startsWith("__Host-portal_session=;")).toBe(true);
    expect(cookie).toContain("Max-Age=0");
  });

  it("404s in every other auth mode", async () => {
    getConfigMock.mockReturnValue({ auth: { mode: "none", none: { email: "a@b.co" } } });
    expect((await POST(request())).status).toBe(404);
  });

  it("returns 403 when Origin does not match the configured baseUrl", async () => {
    const response = await POST(request({ origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });

  it("returns 403 when the Origin header is absent entirely", async () => {
    const response = await POST(request());
    expect(response.status).toBe(403);
  });

  it("does not set or clear any cookie on an Origin mismatch", async () => {
    const response = await POST(request({ origin: "https://evil.example" }));
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
