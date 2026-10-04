import { describe, it, expect } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import { presetFor, issuerFor, hostedDomainTrusted, PROVIDER_PRESETS } from "./presets";

const base: OidcConfig = {
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

describe("presets", () => {
  it("google carries a fixed issuer and requires a hosted domain", () => {
    expect(PROVIDER_PRESETS.google.issuer).toBe("https://accounts.google.com");
    expect(PROVIDER_PRESETS.google.requireHostedDomain).toBe(true);
    expect(issuerFor(base)).toBe("https://accounts.google.com");
  });

  it("an explicit issuer wins over the preset", () => {
    expect(issuerFor({ ...base, issuer: "https://idp.example.com" })).toBe("https://idp.example.com");
  });

  it("a non-google provider with no issuer has none to offer", () => {
    expect(issuerFor({ ...base, provider: "logto" })).toBeNull();
    expect(presetFor({ ...base, provider: "logto" }).requireHostedDomain).toBe(false);
  });
});

describe("hostedDomainTrusted", () => {
  it("trusts hd for a plain google config", () => {
    expect(hostedDomainTrusted(base)).toBe(true);
  });

  it("does not trust hd for a non-google provider", () => {
    expect(hostedDomainTrusted({ ...base, provider: "logto", issuer: "https://idp.example.com" })).toBe(false);
  });

  // The schema now refuses to combine provider: google with an explicit
  // issuer, but this is the defense-in-depth half of that same fix: even if a
  // provider: google config's EFFECTIVE issuer is not Google's own (bypassing
  // the schema somehow, or a future caller that builds a config object by
  // hand), hd trust must turn off rather than stay on because the label says
  // "google".
  it("does not trust hd when a provider: google config's effective issuer is not Google's", () => {
    const mislabeled: OidcConfig = { ...base, provider: "google", issuer: "https://idp.example.com" };
    expect(issuerFor(mislabeled)).toBe("https://idp.example.com");
    expect(hostedDomainTrusted(mislabeled)).toBe(false);
  });
});
