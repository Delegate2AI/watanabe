import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, exportSPKI } from "jose";
import { resolve, resetJwksCacheForTests, type JwtConfig } from "./jwt";
import { log } from "@/lib/log";

const SECRET = "a-shared-secret-long-enough-for-hs256";
const ISS = "https://idp.example.com";
const AUD = "meridian-portal";

const hs256: JwtConfig = {
  algorithm: "HS256",
  secret: SECRET,
  issuer: ISS,
  audience: AUD,
  source: "bearer",
  cookieName: "portal_session",
  emailClaim: "email",
  nameClaim: "name",
};

const key = () => new TextEncoder().encode(SECRET);

async function signHs(
  claims: Record<string, unknown>,
  { exp = "5m", iss = ISS, aud = AUD }: { exp?: string; iss?: string; aud?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key());
}

const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` });

beforeEach(() => {
  resetJwksCacheForTests();
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("jwt — happy path", () => {
  it("resolves email and name from a valid bearer token", async () => {
    const t = await signHs({ email: "alice@example.com", name: "Alice" });
    expect(await resolve(bearer(t), hs256)).toEqual({ email: "alice@example.com", name: "Alice" });
  });

  it("resolves from a cookie when source is cookie", async () => {
    const t = await signHs({ email: "alice@example.com" });
    const headers = new Headers({ cookie: `other=1; portal_session=${t}; x=2` });
    const out = await resolve(headers, { ...hs256, source: "cookie" });
    expect(out?.email).toBe("alice@example.com");
  });

  it("reads a custom email claim", async () => {
    const t = await signHs({ upn: "bob@example.com" });
    const out = await resolve(bearer(t), { ...hs256, emailClaim: "upn" });
    expect(out?.email).toBe("bob@example.com");
  });
});

describe("jwt — rejects, always as null and never as a throw", () => {
  it("no token at all", async () => {
    expect(await resolve(new Headers(), hs256)).toBeNull();
  });

  it("a malformed Authorization header", async () => {
    expect(await resolve(new Headers({ authorization: "Basic abc" }), hs256)).toBeNull();
    expect(await resolve(new Headers({ authorization: "Bearer" }), hs256)).toBeNull();
    expect(await resolve(new Headers({ authorization: "" }), hs256)).toBeNull();
  });

  it("garbage in place of a token does not throw", async () => {
    expect(await resolve(bearer("not.a.jwt"), hs256)).toBeNull();
  });

  it("an expired token", async () => {
    const t = await signHs({ email: "a@b.c" }, { exp: "-1s" });
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("a wrong issuer", async () => {
    const t = await signHs({ email: "a@b.c" }, { iss: "https://evil.example.com" });
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("a wrong audience", async () => {
    const t = await signHs({ email: "a@b.c" }, { aud: "another-app" });
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("a bad signature", async () => {
    const t = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("the-wrong-secret-entirely-here"));
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("a missing email claim", async () => {
    const t = await signHs({ name: "No Email" });
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("a non-string email claim", async () => {
    const t = await signHs({ email: 42 });
    expect(await resolve(bearer(t), hs256)).toBeNull();
  });

  it("the cookie is present but under a different name", async () => {
    const t = await signHs({ email: "a@b.c" });
    const headers = new Headers({ cookie: `session=${t}` });
    expect(await resolve(headers, { ...hs256, source: "cookie" })).toBeNull();
  });

  it("never leaks the token into the log", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const t = await signHs({ email: "a@b.c" }, { exp: "-1s" });
    await resolve(bearer(t), hs256);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(t);
    }
  });
});

describe("jwt — RS256 via JWKS", () => {
  const JWKS_URL = "https://idp.example.com/.well-known/jwks.json";

  async function rsaSetup() {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test-key";
    jwk.alg = "RS256";
    jwk.use = "sig";
    return { privateKey, publicKey, jwks: { keys: [jwk] } };
  }

  const rs256 = (over: Partial<JwtConfig> = {}): JwtConfig => ({
    algorithm: "RS256",
    jwksUrl: JWKS_URL,
    issuer: ISS,
    audience: AUD,
    source: "bearer",
    cookieName: "portal_session",
    emailClaim: "email",
    nameClaim: "name",
    ...over,
  });

  it("verifies a token signed by the JWKS key", async () => {
    const { privateKey, jwks } = await rsaSetup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const t = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(privateKey);
    expect((await resolve(bearer(t), rs256()))?.email).toBe("alice@example.com");
  });

  /**
   * Algorithm confusion. With RS256 configured, an attacker takes the PUBLIC key
   * (which is, by definition, public) and uses it as an HMAC secret to sign an
   * HS256 token. A verifier that trusts the token's own `alg` header would
   * accept it. Pinning `algorithms: [config.algorithm]` is what stops this.
   */
  it("rejects an HS256 token signed with the public key (alg confusion)", async () => {
    const { publicKey, jwks } = await rsaSetup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );
    const spki = await exportSPKI(publicKey);
    const forged = await new SignJWT({ email: "attacker@evil.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(spki));

    expect(await resolve(bearer(forged), rs256())).toBeNull();
  });

  it("fetches the JWKS once across many verifications (the key set is cached)", async () => {
    const { privateKey, jwks } = await rsaSetup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const t = await new SignJWT({ email: "alice@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(privateKey);

    await resolve(bearer(t), rs256());
    await resolve(bearer(t), rs256());
    await resolve(bearer(t), rs256());
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
