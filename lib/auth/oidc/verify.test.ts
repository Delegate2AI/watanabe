import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { verifyIdToken, type VerifyDeps } from "./verify";
import { log } from "@/lib/log";

const ISSUER = "https://accounts.google.com";
const CLIENT_ID = "abc.apps.googleusercontent.com";
const NONCE = "the-nonce";

let privateKey: CryptoKey;
let publicJwkModulus: string;
let getKey: JWTVerifyGetKey;
let deps: VerifyDeps;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  // Kept from pair.publicKey: the alg-confusion test below signs a forged
  // token using this same public key's modulus as an HMAC secret.
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  publicJwkModulus = jwk.n as string;
  getKey = createLocalJWKSet({ keys: [jwk] });
  deps = { getKey, issuer: ISSUER, clientId: CLIENT_ID, nonce: NONCE, emailClaim: "email", nameClaim: "name" };
});
afterEach(() => vi.restoreAllMocks());

/**
 * `sub` defaults to a fixed test subject so every existing accept/reject case
 * in this file, none of which cares about `sub`, keeps satisfying the
 * requiredClaims: ["exp", "iat", "sub"] check in verify.ts without having to
 * name one. Pass `sub: null` to build a token that omits it, for the tests
 * that exercise that check directly.
 */
async function sign(
  claims: Record<string, unknown>,
  { iss = ISSUER, aud = CLIENT_ID, exp = "5m", alg = "RS256", sub = "user-123" as string | null } = {},
) {
  let builder = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: "test-key" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp);
  if (sub !== null) builder = builder.setSubject(sub);
  return builder.sign(privateKey);
}

const valid = () => ({ email: "ada@example.com", email_verified: true, name: "Ada", nonce: NONCE, hd: "example.com" });

describe("verifyIdToken: accepts", () => {
  it("a well-formed token", async () => {
    expect(await verifyIdToken(await sign(valid()), deps)).toEqual({
      email: "ada@example.com",
      name: "Ada",
      hostedDomain: "example.com",
    });
  });

  it("lowercases and trims the email", async () => {
    const out = await verifyIdToken(await sign({ ...valid(), email: "  Ada@Example.COM " }), deps);
    expect(out?.email).toBe("ada@example.com");
  });

  it("a token with no name and no hd", async () => {
    const out = await verifyIdToken(
      await sign({ email: "ada@example.com", email_verified: true, nonce: NONCE }),
      deps,
    );
    expect(out).toEqual({ email: "ada@example.com" });
  });

  it("custom claim names, when the custom claim matches the verified email", async () => {
    // A custom emailClaim is only trusted as identity when it names the same
    // address email_verified actually attests to (see the "a custom
    // emailClaim must be shown to be the verified email" block below), so
    // this fixture carries a standard `email` claim that agrees with `upn`.
    const t = await sign({
      upn: "bob@example.com",
      email: "bob@example.com",
      email_verified: true,
      nonce: NONCE,
      display: "Bob",
    });
    const out = await verifyIdToken(t, { ...deps, emailClaim: "upn", nameClaim: "display" });
    expect(out).toEqual({ email: "bob@example.com", name: "Bob" });
  });
});

describe("verifyIdToken: rejects, always as null", () => {
  it("a wrong audience", async () => {
    expect(await verifyIdToken(await sign(valid(), { aud: "someone-else" }), deps)).toBeNull();
  });

  it("a wrong issuer", async () => {
    expect(await verifyIdToken(await sign(valid(), { iss: "https://evil.example" }), deps)).toBeNull();
  });

  it("an expired token", async () => {
    expect(await verifyIdToken(await sign(valid(), { exp: "-1s" }), deps)).toBeNull();
  });

  it("a mismatched nonce", async () => {
    expect(await verifyIdToken(await sign({ ...valid(), nonce: "other" }), deps)).toBeNull();
  });

  it("a missing nonce", async () => {
    const rest = { email: "ada@example.com", email_verified: true, name: "Ada", hd: "example.com" };
    expect(await verifyIdToken(await sign(rest), deps)).toBeNull();
  });

  it("email_verified false or absent", async () => {
    expect(await verifyIdToken(await sign({ ...valid(), email_verified: false }), deps)).toBeNull();
    const rest = { email: "ada@example.com", name: "Ada", nonce: NONCE, hd: "example.com" };
    expect(await verifyIdToken(await sign(rest), deps)).toBeNull();
  });

  it("a missing or non-string email claim", async () => {
    const rest = { email_verified: true, name: "Ada", nonce: NONCE, hd: "example.com" };
    expect(await verifyIdToken(await sign(rest), deps)).toBeNull();
    expect(await verifyIdToken(await sign({ ...valid(), email: 42 }), deps)).toBeNull();
  });

  it("garbage that is not a JWT at all", async () => {
    expect(await verifyIdToken("not.a.jwt", deps)).toBeNull();
    expect(await verifyIdToken("", deps)).toBeNull();
  });

  it("a token signed with a different key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT(valid())
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verifyIdToken(forged, deps)).toBeNull();
  });

  it("an alg-confusion token: HS256, signed with the RSA public key's modulus as the HMAC secret", async () => {
    // The headline security property of this module is that ALLOWED_ALGORITHMS
    // is asymmetric-only. Without that restriction, a token can nominate its
    // own alg, and an attacker who only knows the provider's PUBLIC key (which
    // is, by definition, public) can mint a token that "verifies" by declaring
    // HS256 and signing with that public key's bytes as a shared secret.
    //
    // A real JWKS getKey (createLocalJWKSet/createRemoteJWKSet) already
    // refuses to hand back an RSA-typed JWK as an HMAC key, which would make a
    // test built on it pass for the wrong reason: it would stay green even if
    // ALLOWED_ALGORITHMS grew an "HS256" entry, because jose's own JWKS
    // resolver is what rejected the request, not this module's allowlist.
    // This test isolates the ALLOWED_ALGORITHMS check itself: getKey below
    // hands back the forged HMAC secret unconditionally, so the only thing
    // standing between this token and a "valid" result is the algorithms
    // restriction in verify.ts. Confirmed to fail (return non-null) when
    // ALLOWED_ALGORITHMS is temporarily widened to include "HS256".
    const hmacSecret = new TextEncoder().encode(publicJwkModulus);
    const confusedGetKey: JWTVerifyGetKey = async () => hmacSecret;
    const forged = await new SignJWT(valid())
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(hmacSecret);
    expect(await verifyIdToken(forged, { ...deps, getKey: confusedGetKey })).toBeNull();
  });
});

describe("verifyIdToken: a custom emailClaim must be shown to be the verified email", () => {
  it("accepts a custom claim that matches the verified email, case-insensitively", async () => {
    const t = await sign({ upn: "  Bob@Example.COM ", email: "bob@example.com", email_verified: true, nonce: NONCE });
    const out = await verifyIdToken(t, { ...deps, emailClaim: "upn" });
    expect(out).toEqual({ email: "bob@example.com" });
  });

  it("rejects a custom claim that differs from the verified email", async () => {
    const t = await sign({
      upn: "eve@allowed.example.com",
      email: "eve@personal-provider.example",
      email_verified: true,
      nonce: NONCE,
    });
    expect(await verifyIdToken(t, { ...deps, emailClaim: "upn" })).toBeNull();
  });

  it("rejects a custom claim with no standard email claim to check it against", async () => {
    const t = await sign({ upn: "eve@allowed.example.com", email_verified: true, nonce: NONCE });
    expect(await verifyIdToken(t, { ...deps, emailClaim: "upn" })).toBeNull();
  });

  it("leaves the default email claim unaffected: no standard-email cross-check applies", async () => {
    // deps.emailClaim is "email" by default, so this is exactly the existing
    // "accepts a well-formed token" path: no other claim is consulted.
    expect(await verifyIdToken(await sign(valid()), deps)).toEqual({
      email: "ada@example.com",
      name: "Ada",
      hostedDomain: "example.com",
    });
  });
});

describe("verifyIdToken: mandatory claims and azp", () => {
  it("rejects a token missing sub", async () => {
    const t = await sign(valid(), { sub: null });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a token with a blank sub", async () => {
    const t = await sign({ ...valid(), sub: "" }, { sub: null });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a token with a non-string sub", async () => {
    const t = await sign({ ...valid(), sub: 12345 }, { sub: null });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a token missing exp", async () => {
    const t = await new SignJWT(valid())
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setSubject("user-123")
      .sign(privateKey);
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a token missing iat", async () => {
    const t = await new SignJWT(valid())
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .setSubject("user-123")
      .sign(privateKey);
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a present azp naming a different client, on a single-audience token", async () => {
    const t = await sign({ ...valid(), azp: "someone-else" });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a blank azp on an otherwise single-audience token", async () => {
    // A blank azp must not collapse to "as if absent": that would let it slip
    // through the single-audience path untouched.
    const t = await sign({ ...valid(), azp: "" });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a non-string azp on an otherwise single-audience token", async () => {
    const t = await sign({ ...valid(), azp: 42 });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a multi-audience token with no azp at all", async () => {
    const t = await sign(valid(), { aud: [CLIENT_ID, "another-client"] });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("rejects a multi-audience token whose azp names a different client", async () => {
    const t = await sign({ ...valid(), azp: "another-client" }, { aud: [CLIENT_ID, "another-client"] });
    expect(await verifyIdToken(t, deps)).toBeNull();
  });

  it("accepts a multi-audience token whose azp names this client", async () => {
    const t = await sign({ ...valid(), azp: CLIENT_ID }, { aud: [CLIENT_ID, "another-client"] });
    expect(await verifyIdToken(t, deps)).not.toBeNull();
  });
});
