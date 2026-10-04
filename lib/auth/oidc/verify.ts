import { errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { log } from "@/lib/log";

/**
 * The single place an ID token becomes claims. Nothing else in the app calls
 * `jwtVerify` on a provider token, so this is the one function to audit and the
 * one the security tests drive.
 *
 * Two layers, in order:
 *  1. jose checks the signature against the provider's JWKS, plus `iss`, `aud`,
 *     `exp`, and (via `requiredClaims`) that `exp`, `iat`, and `sub` are all
 *     present. A token missing any of the three carries no expiry, no
 *     issued-at, or no stable subject to reason about, and none of that is
 *     optional for something about to become a session.
 *  2. The decoded claims are checked here: `azp`, `email_verified`, `nonce`,
 *     and a usable email.
 *
 * Algorithms are restricted to asymmetric ones. This is the alg-confusion
 * defense: with symmetric algorithms permitted, a token could nominate HS256
 * and be signed with the provider's PUBLIC key, which the verifier holds and
 * would accept as a valid MAC.
 *
 * `email_verified` is an assertion about the standard `email` claim and about
 * nothing else. When `emailClaim` names some other claim (`upn`,
 * `preferred_username`, and the like, often user-editable), that claim is
 * trusted as identity only when its value is shown to equal the token's own
 * `email` claim: a custom claim may be an ALIAS for the verified address,
 * never an independent identity `email_verified` never spoke about.
 *
 * Never throws. A hostile string from the open internet resolves to null.
 */

const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"];

export interface VerifiedClaims {
  email: string;
  name?: string;
  /** The provider's own assertion of tenant membership, when it makes one. */
  hostedDomain?: string;
}

export interface VerifyDeps {
  getKey: JWTVerifyGetKey;
  issuer: string;
  clientId: string;
  nonce: string;
  emailClaim: string;
  nameClaim: string;
}

function stringClaim(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function verifyIdToken(
  idToken: string,
  deps: VerifyDeps,
): Promise<VerifiedClaims | null> {
  if (!idToken) return null;

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(idToken, deps.getKey, {
      issuer: deps.issuer,
      audience: deps.clientId,
      algorithms: ALLOWED_ALGORITHMS,
      // Refuses a token that omits any of these rather than treating an
      // absent claim as "nothing to check". Without this, a signed token with
      // no exp never expires, and one with no sub has no stable identity.
      requiredClaims: ["exp", "iat", "sub"],
    });
    payload = verified.payload;
  } catch (error) {
    // Every failure here resolves to null, never a throw: a bad signature, a
    // wrong iss/aud, an expired or claims-incomplete token, and (via the JWKS
    // resolver) a network failure or timeout talking to the provider. `code`
    // separates the reason when jose provides one; anything else logs as
    // "unknown". Never the token.
    const code = error instanceof joseErrors.JOSEError ? error.code : "unknown";
    log.warn("rejected OIDC id token", { code });
    return null;
  }

  // `requiredClaims` above only proves the `sub` property is present, not
  // that it is a usable value: a token with `sub: ""` or `sub: 42` satisfies
  // jose's own check. This is the stable-identity claim the rest of the
  // system would key on, so a blank or non-string value is rejected here even
  // though this module does not itself return `sub` to its caller.
  if (!stringClaim(payload, "sub")) {
    log.warn("rejected OIDC id token", { code: "SUB_INVALID" });
    return null;
  }

  // `azp` names the party the token was issued to when `aud` carries more
  // than one entry, and jose's own `audience` check only requires this
  // client's id to appear SOMEWHERE in `aud`. Without this, a multi-audience
  // token is accepted on the strength of this client's id being merely
  // present, even when `azp` names a different party as the intended
  // recipient. A present `azp` is checked unconditionally (single or multi
  // audience); an absent `azp` is only a problem when `aud` is ambiguous.
  //
  // "Present" is checked on the raw payload, not via `stringClaim`: a blank or
  // non-string `azp` must not collapse to "as if absent", or a token carrying
  // `azp: ""` on a single-audience token would slip through the multi-audience
  // branch below untouched. Any `azp` key at all forces the strict check.
  const azpPresent = Object.hasOwn(payload, "azp");
  const azp = stringClaim(payload, "azp");
  const multiAudience = Array.isArray(payload.aud) && payload.aud.length > 1;
  const azpInvalid = azpPresent ? azp === undefined || azp !== deps.clientId : multiAudience;
  if (azpInvalid) {
    log.warn("rejected OIDC id token", { code: "AZP_MISMATCH" });
    return null;
  }

  if (payload.email_verified !== true) {
    log.warn("rejected OIDC id token", { code: "EMAIL_NOT_VERIFIED" });
    return null;
  }
  // Binds this token to the authorization request that started this sign-in, so
  // a token replayed from another session cannot be presented here.
  if (stringClaim(payload, "nonce") !== deps.nonce) {
    log.warn("rejected OIDC id token", { code: "NONCE_MISMATCH" });
    return null;
  }

  const email = stringClaim(payload, deps.emailClaim);
  if (!email) {
    log.warn("rejected OIDC id token", { code: "NO_EMAIL_CLAIM", claim: deps.emailClaim });
    return null;
  }

  // The default `emailClaim` ("email") needs no further check: it IS the
  // claim `email_verified` is about. Any other claim name is only trustworthy
  // as identity when it is shown to be an alias for that same, already
  // verified address, compared case-insensitively after trimming.
  if (deps.emailClaim !== "email") {
    const standardEmail = stringClaim(payload, "email");
    if (!standardEmail || standardEmail.toLowerCase() !== email.toLowerCase()) {
      log.warn("rejected OIDC id token", { code: "EMAIL_CLAIM_UNVERIFIED", claim: deps.emailClaim });
      return null;
    }
  }

  const name = stringClaim(payload, deps.nameClaim);
  const hostedDomain = stringClaim(payload, "hd");
  return {
    email: email.toLowerCase(),
    ...(name ? { name } : {}),
    ...(hostedDomain ? { hostedDomain } : {}),
  };
}
