import "server-only";
import { loadConfig } from "./load";
import { toPublicConfig, type PublicConfig } from "./public";
import type { PortalConfig } from "./schema";

/**
 * The process-wide `portal.yaml` singleton (spec 16).
 *
 * `import "server-only"` makes importing this from a client component a build
 * error rather than a runtime surprise: the full config carries `auth.jwt.secret`.
 * Client components receive `PublicConfig` as props instead, via
 * `components/app-config-provider.tsx`.
 *
 * Config is read once. `instrumentation.ts#register()` primes it at boot so a
 * malformed file kills the process at startup rather than surfacing as a 500 on
 * whichever request happens to touch it first. The lazy path below is the
 * fallback for contexts that never ran `register()` (unit tests, scripts).
 */

let cached: PortalConfig | null = null;

export function getConfig(): PortalConfig {
  cached ??= loadConfig();
  return cached;
}

/** Server-side only. Never hand the result of `getConfig()` to a client component. */
export function getPublicConfig(): PublicConfig {
  return toPublicConfig(getConfig());
}

/**
 * Boot-time prime. Distinct from `getConfig()` so `instrumentation.ts` reads as
 * "load the config now, and fail now if it is wrong" rather than relying on the
 * side effect of a getter.
 */
export function primeConfig(): PortalConfig {
  cached = loadConfig();
  return cached;
}

/** Test seam: drop the memo so a test can vary the environment between loads. */
export function resetConfigForTests(): void {
  cached = null;
}

export type { PortalConfig } from "./schema";
export type { PublicConfig } from "./public";
export { ConfigError } from "./interpolate";
