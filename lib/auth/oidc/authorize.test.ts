import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { OidcConfig } from "@/lib/config/schema";
import { generatePkce, redirectUri, buildAuthorizationUrl, newAuthorizationRequest } from "./authorize";
import type { ProviderEndpoints } from "./discovery";

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

describe("generatePkce", () => {
  it("produces a challenge that is the S256 digest of the verifier", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("produces a fresh verifier each call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe("redirectUri", () => {
  it("is derived from baseUrl", () => {
    expect(redirectUri(config)).toBe("https://portal.example.com/api/auth/callback");
  });

  it("tolerates a trailing slash on baseUrl", () => {
    expect(redirectUri({ ...config, baseUrl: "https://portal.example.com/" })).toBe(
      "https://portal.example.com/api/auth/callback",
    );
  });
});

describe("buildAuthorizationUrl", () => {
  const url = () =>
    new URL(buildAuthorizationUrl({ endpoints, config, state: "st", nonce: "no", codeChallenge: "ch" }));

  it("carries the required OIDC parameters", () => {
    const u = url();
    expect(u.origin + u.pathname).toBe(endpoints.authorizationEndpoint);
    expect(u.searchParams.get("client_id")).toBe("abc");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("redirect_uri")).toBe("https://portal.example.com/api/auth/callback");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("nonce")).toBe("no");
  });

  it("always uses PKCE S256", () => {
    expect(url().searchParams.get("code_challenge")).toBe("ch");
    expect(url().searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("applies the provider's extra params", () => {
    expect(url().searchParams.get("prompt")).toBe("select_account");
  });

  it("hints hd only when google has exactly one allowed domain", () => {
    expect(url().searchParams.get("hd")).toBe("example.com");
    const many = { ...config, allowedDomains: ["a.com", "b.com"] };
    const u = new URL(buildAuthorizationUrl({ endpoints, config: many, state: "s", nonce: "n", codeChallenge: "c" }));
    expect(u.searchParams.get("hd")).toBeNull();
    const logto = { ...config, provider: "logto" as const };
    const l = new URL(buildAuthorizationUrl({ endpoints, config: logto, state: "s", nonce: "n", codeChallenge: "c" }));
    expect(l.searchParams.get("hd")).toBeNull();
    expect(l.searchParams.get("prompt")).toBeNull();
  });
});

describe("newAuthorizationRequest", () => {
  it("mints state, nonce, and a verifier, and embeds the matching challenge", () => {
    const req = newAuthorizationRequest(config, endpoints);
    expect(req.state).toHaveLength(43);
    expect(req.nonce).toHaveLength(43);
    const challenge = new URL(req.url).searchParams.get("code_challenge");
    expect(challenge).toBe(createHash("sha256").update(req.verifier).digest("base64url"));
    expect(new URL(req.url).searchParams.get("state")).toBe(req.state);
  });
});
