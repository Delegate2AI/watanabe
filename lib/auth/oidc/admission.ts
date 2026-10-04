import type { OidcConfig } from "@/lib/config/schema";
import { hostedDomainTrusted } from "./presets";
import type { VerifiedClaims } from "./verify";

/**
 * Is this verified person allowed into this portal.
 *
 * Runs only on claims that already passed signature and nonce verification, so
 * every value here is the provider's assertion rather than the caller's.
 *
 * Order matters:
 *  1. An exact entry in `allowedEmails` admits, and skips the domain rule
 *     entirely. This is the contractor on a personal account.
 *  2. `hd` is trusted only when `hostedDomainTrusted(config)` holds: the
 *     provider's preset asserts tenant membership in `hd` AND the effective
 *     issuer is exactly Google's fixed issuer, not merely whatever the
 *     `provider` label says. A token from a trusted provider with no `hd` is
 *     refused; for Google that claim is the difference between a Workspace
 *     account and a personal one. `hd` from any other provider (or from a
 *     mislabeled `provider: google` pointed at a different issuer) is ignored
 *     rather than trusted, since it is then a custom claim with no OIDC
 *     meaning and often a user-editable one.
 *  3. Otherwise the domain of the verified email decides, which is the only
 *     signal a provider with no `hd` concept offers.
 *
 * Empty lists admit nobody. `assertOidcConfigured` already refuses to boot in
 * that state; this is the second half of the same rule, so a future caller that
 * skips the boot check still fails closed.
 */

const fold = (value: string) => value.trim().toLowerCase();

function emailDomain(email: string): string | null {
  const parts = email.split("@");
  // Exactly one "@", and something on each side. "user@notadomain@example.com"
  // is not a well-formed address, and reading its last segment as the domain
  // would admit it on the strength of a suffix the provider never asserted.
  if (parts.length !== 2) return null;
  const local = parts[0] as string;
  const domain = fold(parts[1] as string);
  return local.trim().length > 0 && domain.length > 0 ? domain : null;
}

export function isAdmitted(claims: VerifiedClaims, config: OidcConfig): boolean {
  const email = fold(claims.email);
  if (config.allowedEmails.some((allowed) => fold(allowed) === email)) return true;

  const domains = config.allowedDomains.map(fold);
  if (domains.length === 0) return false;

  // Only trust `hd` when the effective issuer is Google's. `hd` is a Google
  // Workspace claim with no meaning in the OIDC spec: on Keycloak, Auth0, or
  // Logto (or a `provider: google` config somehow pointed at a non-Google
  // issuer) it is an arbitrary custom claim, often mapped from a user-editable
  // profile attribute, and treating it as authoritative there would let
  // anyone set their own "hd" and walk straight past the domain check.
  const hdTrusted = hostedDomainTrusted(config);
  const asserted = hdTrusted && claims.hostedDomain ? fold(claims.hostedDomain) : null;
  if (asserted) return domains.includes(asserted);

  // No asserted tenant. For a provider that always sends one, its absence means
  // a personal account, and there is nothing left to check.
  if (hdTrusted) return false;

  const domain = emailDomain(email);
  return domain !== null && domains.includes(domain);
}
