import type { OidcConfig } from "@/lib/config/schema";

/**
 * What differs between identity providers, kept in one table.
 *
 * The flow itself is plain OIDC and identical everywhere. Three things are not:
 * whether the issuer is a fixed well-known URL, whether the provider asserts
 * tenant membership in an `hd` claim, and which extra authorization parameters
 * it understands. Everything else about a provider comes from its own discovery
 * document, so adding one is an entry here, not a code path.
 */

export type OidcProvider = OidcConfig["provider"];

export interface ProviderPreset {
  /** The provider's fixed issuer, or null when the operator must supply one. */
  issuer: string | null;
  /**
   * Whether the provider asserts Workspace or tenant membership in an `hd`
   * claim. When true, admission trusts `hd` and REFUSES a token without one:
   * for Google, a token with no `hd` is a personal account.
   */
  requireHostedDomain: boolean;
  extraAuthParams: Record<string, string>;
}

export const PROVIDER_PRESETS: Record<OidcProvider, ProviderPreset> = {
  google: {
    issuer: "https://accounts.google.com",
    requireHostedDomain: true,
    // Without this, Google silently reuses whichever account the browser last
    // used, which is the wrong one on any shared or multi-account machine.
    extraAuthParams: { prompt: "select_account" },
  },
  logto: { issuer: null, requireHostedDomain: false, extraAuthParams: {} },
  generic: { issuer: null, requireHostedDomain: false, extraAuthParams: {} },
};

export function presetFor(config: OidcConfig): ProviderPreset {
  return PROVIDER_PRESETS[config.provider];
}

/**
 * The issuer to discover against: the operator's, else the preset's, else none.
 * Null is reachable only for a config that `assertOidcConfigured` would have
 * refused at boot, so callers treat it as an unreachable provider rather than
 * as a crash.
 */
export function issuerFor(config: OidcConfig): string | null {
  return config.issuer ?? PROVIDER_PRESETS[config.provider].issuer;
}

/**
 * Whether `hd` may be trusted as this config's tenant-membership assertion.
 *
 * Gated on the EFFECTIVE issuer being exactly Google's fixed issuer, not on
 * the `provider` label alone. The schema refuses to combine `provider:
 * google` with an explicit `issuer`, but this is defense in depth for that
 * same gap: `issuerFor` prefers an explicit `issuer` over the preset's, so if
 * a `provider: google` config ever reaches this point with an effective
 * issuer that is not Google's, `hd` trust turns off rather than staying on
 * the strength of a label a non-Google issuer could have set to anything.
 */
export function hostedDomainTrusted(config: OidcConfig): boolean {
  return presetFor(config).requireHostedDomain && issuerFor(config) === PROVIDER_PRESETS.google.issuer;
}
