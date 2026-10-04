import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import { resolveStrategy } from "./identity";
import { PortalConfigSchema } from "@/lib/config/schema";
import { resetProxyWarningForTests } from "./strategies/proxy-header";
import { log } from "@/lib/log";

/**
 * The dispatcher picks a strategy from `auth.mode`. These assert the routing
 * itself; each strategy's own behavior is tested next to it.
 */

const auth = (doc: unknown) => PortalConfigSchema.parse({ auth: doc }).auth;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetProxyWarningForTests();
  vi.spyOn(log, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("resolveStrategy", () => {
  it("proxy-header mode reads the configured header names", async () => {
    const cfg = auth({ mode: "proxy-header", proxyHeader: { emailHeader: "X-Custom-Email" } });
    const out = await resolveStrategy(new Headers({ "X-Custom-Email": "alice@x.com" }), cfg);
    expect(out?.email).toBe("alice@x.com");
  });

  it("proxy-header mode ignores the DEFAULT header when a custom one is configured", async () => {
    const cfg = auth({ mode: "proxy-header", proxyHeader: { emailHeader: "X-Custom-Email" } });
    const out = await resolveStrategy(new Headers({ "X-Auth-Request-Email": "alice@x.com" }), cfg);
    expect(out).toBeNull();
  });

  it("none mode returns the fixed identity regardless of headers", async () => {
    const cfg = auth({ mode: "none", none: { email: "dev@example.com" } });
    const out = await resolveStrategy(new Headers({ "X-Auth-Request-Email": "someone@else.com" }), cfg);
    expect(out).toEqual({ email: "dev@example.com" });
  });

  it("jwt mode verifies a token and ignores proxy headers", async () => {
    const secret = "a-shared-secret-long-enough-for-hs256";
    const cfg = auth({
      mode: "jwt",
      jwt: { algorithm: "HS256", secret, issuer: "https://idp", audience: "portal", source: "bearer" },
    });
    const token = await new SignJWT({ email: "jwt@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://idp")
      .setAudience("portal")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));

    const headers = new Headers({
      authorization: `Bearer ${token}`,
      // A forged proxy header must not influence jwt mode at all.
      "X-Auth-Request-Email": "attacker@evil.com",
    });
    expect(await resolveStrategy(headers, cfg)).toEqual({ email: "jwt@example.com", name: undefined });
  });

  it("jwt mode returns null (not the proxy header) when the token is absent", async () => {
    const cfg = auth({
      mode: "jwt",
      jwt: { algorithm: "HS256", secret: "x".repeat(32), issuer: "i", audience: "a" },
    });
    const headers = new Headers({ "X-Auth-Request-Email": "attacker@evil.com" });
    expect(await resolveStrategy(headers, cfg)).toBeNull();
  });
});
