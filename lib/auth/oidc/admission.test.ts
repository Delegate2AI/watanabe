import { describe, it, expect } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import { isAdmitted } from "./admission";
import type { VerifiedClaims } from "./verify";

const google: OidcConfig = {
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
const generic: OidcConfig = { ...google, provider: "generic", issuer: "https://idp.example.com" };

const claims = (over: Partial<VerifiedClaims> = {}): VerifiedClaims => ({
  email: "ada@example.com",
  hostedDomain: "example.com",
  ...over,
});

describe("isAdmitted: google, where hd is the authority", () => {
  it("admits a matching hosted domain", () => {
    expect(isAdmitted(claims(), google)).toBe(true);
  });

  it("refuses a hosted domain that is not on the list", () => {
    expect(isAdmitted(claims({ hostedDomain: "other.com" }), google)).toBe(false);
  });

  it("refuses a personal account, which has no hd at all", () => {
    expect(isAdmitted({ email: "ada@gmail.com" }, google)).toBe(false);
  });

  it("refuses an email whose domain matches while hd does not", () => {
    expect(isAdmitted({ email: "ada@example.com", hostedDomain: "other.com" }, google)).toBe(false);
  });

  it("matches case-insensitively on both sides", () => {
    const config = { ...google, allowedDomains: ["Example.COM"] };
    expect(isAdmitted(claims({ hostedDomain: "example.com" }), config)).toBe(true);
    expect(isAdmitted(claims({ hostedDomain: "EXAMPLE.com" }), google)).toBe(true);
  });
});

describe("isAdmitted: providers with no hd concept", () => {
  it("falls back to the verified email domain", () => {
    expect(isAdmitted({ email: "ada@example.com" }, generic)).toBe(true);
    expect(isAdmitted({ email: "ada@other.com" }, generic)).toBe(false);
  });

  it("ignores hd from a provider whose preset does not assert one", () => {
    expect(isAdmitted({ email: "ada@other.com", hostedDomain: "example.com" }, generic)).toBe(false);
  });

  it("refuses an email with no domain part", () => {
    expect(isAdmitted({ email: "not-an-email" }, generic)).toBe(false);
  });
});

describe("isAdmitted: the email allowlist", () => {
  it("admits an exact match regardless of domain", () => {
    const config = { ...google, allowedEmails: ["contractor@gmail.com"] };
    expect(isAdmitted({ email: "contractor@gmail.com" }, config)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const config = { ...google, allowedEmails: ["Contractor@Gmail.com"] };
    expect(isAdmitted({ email: "contractor@gmail.com" }, config)).toBe(true);
  });

  it("does not admit a near miss", () => {
    const config = { ...google, allowedEmails: ["contractor@gmail.com"] };
    expect(isAdmitted({ email: "contractor@gmail.com.evil.com" }, config)).toBe(false);
  });

  it("refuses everyone when both lists are empty", () => {
    const config = { ...google, allowedDomains: [], allowedEmails: [] };
    expect(isAdmitted(claims(), config)).toBe(false);
  });
});

describe("isAdmitted: malformed and adversarial inputs", () => {
  it("refuses an email with more than one @", () => {
    expect(isAdmitted({ email: "user@notadomain@example.com" }, generic)).toBe(false);
  });

  it("refuses an email with an empty local part", () => {
    expect(isAdmitted({ email: "@example.com" }, generic)).toBe(false);
  });

  it("refuses a subdomain of an allowed domain", () => {
    expect(isAdmitted({ email: "eve@evil.example.com" }, generic)).toBe(false);
  });

  it("refuses a domain with a trailing dot", () => {
    expect(isAdmitted({ email: "eve@example.com." }, generic)).toBe(false);
  });

  it("treats an empty hd as absent, so a google token is refused", () => {
    expect(isAdmitted({ email: "ada@example.com", hostedDomain: "" }, google)).toBe(false);
  });

  it("refuses a homoglyph domain that only looks like an allowed one", () => {
    // Cyrillic small letter ie (U+0435) standing in for ASCII "e".
    expect(isAdmitted({ email: "ada@examplе.com" }, generic)).toBe(false);
  });

  it("tolerates whitespace on both the config entry and the claim", () => {
    const padded = { ...generic, allowedDomains: ["  example.com  "] };
    expect(isAdmitted({ email: "ada@example.com" }, padded)).toBe(true);
    expect(isAdmitted({ email: "ada@example.com", hostedDomain: " example.com " }, padded)).toBe(true);
  });
});

describe("isAdmitted: hd trust is gated on the effective issuer, not the provider label", () => {
  // The schema refuses provider: google with an explicit issuer, but this
  // proves the defense-in-depth half of that fix directly against isAdmitted:
  // even a hand-built config carrying provider: google and a non-Google
  // issuer must not get Google's hd trust.
  const mislabeled: OidcConfig = { ...google, issuer: "https://idp.example.com" };

  it("ignores hd from a provider: google config whose effective issuer is not Google's", () => {
    expect(isAdmitted({ email: "eve@other.com", hostedDomain: "example.com" }, mislabeled)).toBe(false);
  });

  it("still admits it on the verified email's own domain", () => {
    expect(isAdmitted({ email: "ada@example.com", hostedDomain: "other.com" }, mislabeled)).toBe(true);
  });
});
