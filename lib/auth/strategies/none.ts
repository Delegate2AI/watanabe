import type { Identity } from "../types";

/**
 * The no-auth strategy (spec 16): every request resolves to one fixed identity.
 *
 * Reaching this code at all requires BOTH `auth.mode: none` in `portal.yaml`
 * AND `PORTAL_ALLOW_NO_AUTH=1` in the environment. That second gate lives in
 * `lib/config/load.ts#assertNoAuthAllowed`, at boot, so a `portal.yaml` that
 * leaks into a production image cannot disarm authentication on its own and the
 * process refuses to start rather than serving an open portal.
 *
 * There is deliberately nothing to fail here: no headers are read, so no
 * request can influence who it is authenticated as.
 */

export interface NoneConfig {
  email: string;
  name?: string;
}

export function resolve(config: NoneConfig): Identity {
  return { email: config.email, ...(config.name ? { name: config.name } : {}) };
}
