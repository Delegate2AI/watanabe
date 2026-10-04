import { describe, it, expect } from "vitest";
import { PortalConfigSchema } from "./schema";
import { toPublicConfig } from "./public";

const SENTINEL = "SUPER-SECRET-SENTINEL-VALUE";

const hs256 = PortalConfigSchema.parse({
  auth: {
    mode: "jwt",
    jwt: { algorithm: "HS256", secret: SENTINEL, issuer: "https://idp", audience: "portal" },
  },
});

const proxy = PortalConfigSchema.parse({
  auth: { mode: "proxy-header", proxyHeader: { assertSecret: SENTINEL } },
});

/** Every key name appearing anywhere in a nested value. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe("toPublicConfig", () => {
  it("carries the branding fields the browser needs", () => {
    const pub = toPublicConfig(hs256);
    expect(pub.app.name).toBe("Watanabe");
    expect(pub.app.navLabel).toBe("Knowledge base");
    expect(pub.app.starters.length).toBeGreaterThan(0);
  });

  // The important one: a JWT signing key must never reach the browser bundle.
  it("does not contain a jwt secret anywhere in its serialized form", () => {
    expect(JSON.stringify(toPublicConfig(hs256))).not.toContain(SENTINEL);
  });

  it("does not contain the proxy assert secret anywhere in its serialized form", () => {
    expect(JSON.stringify(toPublicConfig(proxy))).not.toContain(SENTINEL);
  });

  it("has no `auth` key at any depth", () => {
    expect(allKeys(toPublicConfig(hs256)).has("auth")).toBe(false);
  });

  // Structural, not a spot-check: adding a field to PublicConfig must be a
  // deliberate act that updates this list, so a secret cannot leak by omission.
  it("exposes exactly the allowlisted keys", () => {
    const pub = toPublicConfig(hs256);
    expect(Object.keys(pub).sort()).toEqual(["app", "terms"]);
    expect(Object.keys(pub.app).sort()).toEqual(["composerPlaceholder", "name", "navLabel", "starters", "tagline"]);
  });

  it("omits kbDescription: it steers the system prompt, not the browser", () => {
    expect(allKeys(toPublicConfig(hs256)).has("kbDescription")).toBe(false);
  });

  it("leaks no key that exists only under auth", () => {
    const publicKeys = allKeys(toPublicConfig(hs256));
    for (const forbidden of ["secret", "jwksUrl", "assertSecret", "issuer", "audience", "mode"]) {
      expect(publicKeys.has(forbidden)).toBe(false);
    }
  });
});
