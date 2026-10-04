import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getIdentity, requireIdentity, unauthorized } from "./identity";
import { log } from "@/lib/log";
import { resetConfigForTests } from "@/lib/config";
import { resetProxyWarningForTests } from "./strategies/proxy-header";

// Identity is the top of the whole ownership boundary: get this wrong and
// every downstream 403 check is meaningless. These tests exercise the exact
// precedence rules described in identity.ts's doc comment, directly (not by
// eyeballing the routes that call it).
//
// `vi.stubEnv` (rather than direct `process.env.X =`) sidesteps
// `NODE_ENV`'s readonly type in @types/node and is auto-restored by
// `vi.unstubAllEnvs()`.

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // The config singleton and the proxy strategy's once-per-process warning are
  // both module state; a test that stubs env must not inherit a previous load.
  resetConfigForTests();
  resetProxyWarningForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getIdentity — SSO header (production path)", () => {
  it("resolves email + name from X-Auth-Request-Email / X-Auth-Request-User", async () => {
    const headers = new Headers({
      "X-Auth-Request-Email": "alice@example.com",
      "X-Auth-Request-User": "Alice",
    });
    expect(await getIdentity(headers)).toEqual({ email: "alice@example.com", name: "Alice" });
  });

  it("works without a name header", async () => {
    const headers = new Headers({ "X-Auth-Request-Email": "alice@example.com" });
    expect(await getIdentity(headers)).toEqual({ email: "alice@example.com", name: undefined });
  });

  it("takes precedence over DEV_IDENTITY_EMAIL and the dev header", async () => {
    vi.stubEnv("DEV_IDENTITY_EMAIL", "env-user@example.com");
    vi.stubEnv("PORTAL_ALLOW_DEV_IDENTITY_HEADER", "1");
    const headers = new Headers({
      "X-Auth-Request-Email": "sso-user@example.com",
      "X-Dev-Identity-Email": "dev-header-user@example.com",
    });
    expect((await getIdentity(headers))?.email).toBe("sso-user@example.com");
  });
});

describe("getIdentity — proxy assertion (ClusterIP-bypass fix)", () => {
  const SECRET = "s3cr3t-proxy-assertion-value";

  it("(a) trusts SSO identity when the assertion header matches the secret", async () => {
    vi.stubEnv("PORTAL_PROXY_ASSERT_SECRET", SECRET);
    const headers = new Headers({
      "X-Auth-Request-Email": "alice@example.com",
      "X-Auth-Request-User": "Alice",
      "X-Portal-Proxy-Assert": SECRET,
    });
    expect(await getIdentity(headers)).toEqual({ email: "alice@example.com", name: "Alice" });
  });

  it("(b) rejects SSO identity when the assertion header is absent (direct-to-ClusterIP spoof)", async () => {
    vi.stubEnv("PORTAL_PROXY_ASSERT_SECRET", SECRET);
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const headers = new Headers({ "X-Auth-Request-Email": "victim@example.com" });
    expect(await getIdentity(headers)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "rejected SSO identity: missing/invalid proxy assertion",
      { hasAssert: false },
    );
  });

  it("(c) rejects SSO identity when the assertion header value is wrong", async () => {
    vi.stubEnv("PORTAL_PROXY_ASSERT_SECRET", SECRET);
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const headers = new Headers({
      "X-Auth-Request-Email": "victim@example.com",
      "X-Portal-Proxy-Assert": "not-the-secret",
    });
    expect(await getIdentity(headers)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "rejected SSO identity: missing/invalid proxy assertion",
      { hasAssert: true },
    );
  });

  it("a rejected SSO header does not leak into dev/env fallbacks (still 401 in a locked-down prod)", async () => {
    vi.stubEnv("PORTAL_PROXY_ASSERT_SECRET", SECRET);
    // No dev flag, no DEV_IDENTITY_EMAIL → the forged SSO header resolves to nothing.
    const headers = new Headers({ "X-Auth-Request-Email": "victim@example.com" });
    expect(await getIdentity(headers)).toBeNull();
  });

  it("with the secret unset, falls back to trusting X-Auth-Request-* unverified (rollout safety)", async () => {
    // PORTAL_PROXY_ASSERT_SECRET intentionally unset.
    const headers = new Headers({ "X-Auth-Request-Email": "alice@example.com" });
    expect((await getIdentity(headers))?.email).toBe("alice@example.com");
  });

  it("warns exactly once per process when trusting SSO without an assertion secret", async () => {
    // Fresh module so the once-per-process guard starts un-tripped.
    vi.resetModules();
    const freshLog = (await import("@/lib/log")).log;
    const warnSpy = vi.spyOn(freshLog, "warn").mockImplementation(() => {});
    const fresh = await import("./identity");

    const headers = new Headers({ "X-Auth-Request-Email": "alice@example.com" });
    expect((await fresh.getIdentity(headers))?.email).toBe("alice@example.com");
    expect((await fresh.getIdentity(headers))?.email).toBe("alice@example.com");

    const noAssertWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("WITHOUT proxy assertion"),
    );
    expect(noAssertWarns).toHaveLength(1);
  });
});

describe("getIdentity — DEV_IDENTITY_EMAIL fallback (local dev, server-wide)", async () => {
  it("(a) resolves as the env-configured user when no header is present", async () => {
    vi.stubEnv("DEV_IDENTITY_EMAIL", "alice@x.com");
    const headers = new Headers();
    expect(await getIdentity(headers)).toEqual({ email: "alice@x.com", name: undefined });
  });
});

describe("getIdentity — no identity at all", () => {
  it("(b) returns null when neither the header nor the env var is present", async () => {
    const headers = new Headers();
    expect(await getIdentity(headers)).toBeNull();
  });
});

describe("getIdentity — X-Dev-Identity-Email (local dev, per-request override)", () => {
  it("resolves per-request identity from the dev header when explicitly enabled", async () => {
    vi.stubEnv("PORTAL_ALLOW_DEV_IDENTITY_HEADER", "1");
    const headers = new Headers({ "X-Dev-Identity-Email": "bob@example.com" });
    expect(await getIdentity(headers)).toEqual({ email: "bob@example.com", name: undefined });
  });

  it("lets two different requests resolve two different identities against one process", async () => {
    vi.stubEnv("PORTAL_ALLOW_DEV_IDENTITY_HEADER", "1");
    const aliceReq = await getIdentity(new Headers({ "X-Dev-Identity-Email": "alice@x.com" }));
    const bobReq = await getIdentity(new Headers({ "X-Dev-Identity-Email": "bob@x.com" }));
    expect(aliceReq?.email).toBe("alice@x.com");
    expect(bobReq?.email).toBe("bob@x.com");
  });

  it("is ignored by default even when NODE_ENV is unset (fails CLOSED)", async () => {
    // The old gate keyed off NODE_ENV !== "production"; an unset NODE_ENV must
    // NOT open a client-controllable impersonation bypass. Flag absent → ignored.
    vi.stubEnv("NODE_ENV", "");
    const headers = new Headers({ "X-Dev-Identity-Email": "bob@example.com" });
    expect(await getIdentity(headers)).toBeNull();
  });

  it("is ignored in production without the flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = new Headers({ "X-Dev-Identity-Email": "bob@example.com" });
    expect(await getIdentity(headers)).toBeNull();
  });

  it("is honored regardless of NODE_ENV when PORTAL_ALLOW_DEV_IDENTITY_HEADER=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PORTAL_ALLOW_DEV_IDENTITY_HEADER", "1");
    const headers = new Headers({ "X-Dev-Identity-Email": "bob@example.com" });
    expect((await getIdentity(headers))?.email).toBe("bob@example.com");
  });

  it("falls through to DEV_IDENTITY_EMAIL when the dev header is present but not allowed", async () => {
    vi.stubEnv("DEV_IDENTITY_EMAIL", "fallback@example.com");
    const headers = new Headers({ "X-Dev-Identity-Email": "bob@example.com" });
    expect((await getIdentity(headers))?.email).toBe("fallback@example.com");
  });
});

describe("requireIdentity / unauthorized", () => {
  it("returns { identity } when resolvable", async () => {
    const result = await requireIdentity(new Headers({ "X-Auth-Request-Email": "alice@x.com" }));
    expect("identity" in result && result.identity.email).toBe("alice@x.com");
  });

  it("returns a 401 Response when identity cannot be resolved", async () => {
    const result = await requireIdentity(new Headers());
    expect("response" in result).toBe(true);
    if ("response" in result) {
      expect(result.response.status).toBe(401);
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toMatch(/no identity/i);
    }
  });

  it("unauthorized() is a plain clear 401, not a silent failure", async () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
