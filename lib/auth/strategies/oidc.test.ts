import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import { resolve } from "./oidc";
import { mintSession } from "../session";
import { log } from "@/lib/log";

const SECRET = "a".repeat(32);

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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("oidc strategy", () => {
  // config's baseUrl is https, so the cookie the strategy looks for carries
  // the __Host- prefix (see lib/auth/session.ts#withHostPrefix): a real
  // browser only sends back the name the portal actually set.
  it("resolves the identity carried by a valid session cookie", async () => {
    const token = await mintSession({ email: "ada@example.com", name: "Ada" }, config);
    const headers = new Headers({ cookie: `other=1; __Host-portal_session=${token}; x=2` });
    expect(await resolve(headers, config)).toEqual({ email: "ada@example.com", name: "Ada" });
  });

  it("honors a custom cookie name", async () => {
    const custom = { ...config, cookieName: "wk_sid" };
    const token = await mintSession({ email: "ada@example.com" }, custom);
    expect(await resolve(new Headers({ cookie: `__Host-wk_sid=${token}` }), custom)).toEqual({
      email: "ada@example.com",
    });
  });

  it("does not prefix the cookie name under a loopback http baseUrl", async () => {
    const local = { ...config, baseUrl: "http://localhost:3100" };
    const token = await mintSession({ email: "ada@example.com" }, local);
    expect(await resolve(new Headers({ cookie: `portal_session=${token}` }), local)).toEqual({
      email: "ada@example.com",
    });
  });

  it("returns null with no cookie header at all", async () => {
    expect(await resolve(new Headers(), config)).toBeNull();
  });

  it("returns null for a cookie that is not ours", async () => {
    expect(await resolve(new Headers({ cookie: "something=else" }), config)).toBeNull();
  });

  it("returns null for the unprefixed name once the deployment is https", async () => {
    const token = await mintSession({ email: "ada@example.com" }, config);
    // A hostile sibling subdomain could still set this exact unprefixed name;
    // the strategy must not treat it as the session this portal minted.
    expect(await resolve(new Headers({ cookie: `portal_session=${token}` }), config)).toBeNull();
  });

  it("returns null, never a throw, for a garbage cookie value", async () => {
    await expect(resolve(new Headers({ cookie: "__Host-portal_session=garbage" }), config)).resolves.toBeNull();
    await expect(resolve(new Headers({ cookie: "__Host-portal_session=" }), config)).resolves.toBeNull();
    await expect(
      resolve(new Headers({ cookie: "__Host-portal_session=%E0%A4%A" }), config),
    ).resolves.toBeNull();
  });
});
