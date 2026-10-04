import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import type { OidcConfig } from "@/lib/config/schema";
import { completeLogin } from "./flow";
import { resetDiscoveryCacheForTests } from "./discovery";
import { log } from "@/lib/log";

const ISSUER = "https://accounts.google.com";
const CLIENT_ID = "abc.apps.googleusercontent.com";

const config: OidcConfig = {
  provider: "google",
  clientId: CLIENT_ID,
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
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
};

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function idToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject("user-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

/** Discovery, JWKS, and token endpoint, all answered from one mock. */
function stubNetwork(token: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("openid-configuration")) return json(DOC);
      if (url.includes("oauth2/v3/certs")) return json({ keys: [publicJwk] });
      if (url.includes("token")) return json({ id_token: token });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

const base = {
  config,
  clientSecret: "shh",
  code: "the-code",
  state: "st",
  stateCookie: "st",
  nonceCookie: "no",
  verifierCookie: "ver",
  signal: AbortSignal.timeout(2000),
};

beforeEach(async () => {
  resetDiscoveryCacheForTests();
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "k1";
  jwk.alg = "RS256";
  jwk.use = "sig";
  publicJwk = jwk as Record<string, unknown>;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("completeLogin: refuses before touching the network", () => {
  it("missing code", async () => {
    expect(await completeLogin({ ...base, code: "" })).toEqual({ ok: false, reason: "missing_params" });
  });

  it("missing state cookie", async () => {
    expect(await completeLogin({ ...base, stateCookie: null })).toEqual({ ok: false, reason: "missing_params" });
  });

  it("missing nonce or verifier cookie", async () => {
    expect(await completeLogin({ ...base, nonceCookie: null })).toEqual({ ok: false, reason: "missing_params" });
    expect(await completeLogin({ ...base, verifierCookie: null })).toEqual({ ok: false, reason: "missing_params" });
  });

  it("a state that does not match its cookie", async () => {
    expect(await completeLogin({ ...base, state: "other" })).toEqual({ ok: false, reason: "state_mismatch" });
  });
});

describe("completeLogin: the full path", () => {
  it("admits a verified, allowed person", async () => {
    stubNetwork(await idToken({ email: "ada@example.com", email_verified: true, name: "Ada", nonce: "no", hd: "example.com" }));
    expect(await completeLogin(base)).toEqual({ ok: true, identity: { email: "ada@example.com", name: "Ada" } });
  });

  it("refuses a verified person from a domain that is not allowed", async () => {
    stubNetwork(await idToken({ email: "eve@other.com", email_verified: true, nonce: "no", hd: "other.com" }));
    expect(await completeLogin(base)).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("refuses a token whose nonce does not match the cookie", async () => {
    stubNetwork(await idToken({ email: "ada@example.com", email_verified: true, nonce: "stale", hd: "example.com" }));
    expect(await completeLogin(base)).toEqual({ ok: false, reason: "token_invalid" });
  });

  it("reports a failed exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("openid-configuration")) return json(DOC);
        return json({ error: "invalid_grant" }, 400);
      }),
    );
    expect(await completeLogin(base)).toEqual({ ok: false, reason: "exchange_failed" });
  });

  it("reports an unreachable provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await completeLogin(base)).toEqual({ ok: false, reason: "provider_unreachable" });
  });
});
