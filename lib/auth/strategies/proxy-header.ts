import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import type { Identity, HeaderSource } from "../types";

/**
 * The oauth2-proxy SSO strategy: today's behavior, moved out of identity.ts
 * unchanged (spec 16).
 *
 * Production: an nginx `oauth2-proxy` SSO gateway sits in front of this app and
 * forwards `X-Auth-Request-Email` / `X-Auth-Request-User` on every
 * authenticated request. This module only *consumes* those headers; it never
 * talks to an identity provider itself.
 *
 * Proof-of-transit (the ClusterIP-bypass fix): the app's k8s Service is
 * `ClusterIP`, so any in-cluster pod can reach it directly, skip the ingress /
 * oauth2-proxy entirely, and forge `X-Auth-Request-Email: victim@...`. Header
 * presence alone is therefore NOT proof the request came through SSO. To close
 * that gap the ingress injects a shared-secret header `X-Portal-Proxy-Assert:
 * <secret>`. We trust `X-Auth-Request-*` only when that assertion header is
 * present AND its value matches the secret (constant-time compare). A direct
 * in-cluster caller cannot know the secret, so its spoof is rejected.
 *
 * When the secret is UNSET (local dev, or a cluster where the ingress
 * annotation is not wired yet) we fall back to trusting `X-Auth-Request-*`
 * unverified so nothing breaks mid-rollout, but emit a once-per-process `warn`
 * so the gap is visible in logs.
 */

export interface ProxyHeaderConfig {
  emailHeader: string;
  userHeader: string;
  assertHeader: string;
  assertSecret?: string;
}

/** Warn at most once per process when running without proxy assertion. */
let warnedMissingAssertSecret = false;

/** Test seam: the once-per-process warning is process state, not request state. */
export function resetProxyWarningForTests(): void {
  warnedMissingAssertSecret = false;
}

function clean(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

/**
 * Constant-time string compare. Length mismatch short-circuits (lengths are not
 * secret). Exported for reuse by `app/api/repo/refresh/route.ts`, which needs
 * the identical shared-secret comparison for GitLab's webhook token header.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Whether the `X-Auth-Request-*` headers on this request are trustworthy.
 *
 * The secret is read from the environment first and the config second. Both
 * paths exist because `PORTAL_PROXY_ASSERT_SECRET` predates `portal.yaml` and
 * remains the documented deploy mechanism; env-over-config also matches the
 * precedence `loadConfig()` applies. Reading env at call time (rather than
 * baking it into the memoized config) keeps this responsive to a test's
 * `vi.stubEnv`.
 */
function ssoHeadersTrusted(headers: HeaderSource, config: ProxyHeaderConfig): boolean {
  const secret = clean(process.env.PORTAL_PROXY_ASSERT_SECRET) ?? clean(config.assertSecret);

  if (!secret) {
    if (!warnedMissingAssertSecret) {
      warnedMissingAssertSecret = true;
      log.warn(
        "identity running WITHOUT proxy assertion — X-Auth-Request-* trusted unverified; " +
          "set PORTAL_PROXY_ASSERT_SECRET to close the ClusterIP-bypass gap",
      );
    }
    return true;
  }

  const provided = headers.get(config.assertHeader.toLowerCase());
  const hasAssert = clean(provided) !== undefined;
  if (!hasAssert || !constantTimeEquals(provided as string, secret)) {
    // Audit the rejection. Never log the secret. `hasAssert` distinguishes a
    // direct-to-ClusterIP caller (no header) from a wrong-secret attempt.
    log.warn("rejected SSO identity: missing/invalid proxy assertion", { hasAssert });
    return false;
  }
  return true;
}

/** Resolve an identity from the proxy's headers, or `null` if untrusted/absent. */
export function resolve(headers: HeaderSource, config: ProxyHeaderConfig): Identity | null {
  const email = clean(headers.get(config.emailHeader.toLowerCase()));
  if (!email) return null;
  if (!ssoHeadersTrusted(headers, config)) return null;
  return { email, name: clean(headers.get(config.userHeader.toLowerCase())) };
}
