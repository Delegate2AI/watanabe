import { createHash } from "node:crypto";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Product analytics config, resolved server-side and passed to the client
 * island as props, so nothing here is read from the browser. Shared with
 * `lib/analytics/server.ts`, which sends events and exceptions from the server.
 *
 * Events go straight to the instance host: it is not Cloudflare-proxied, so no
 * same-origin proxy is needed.
 */

export function posthogHost(): string | null {
  return process.env.POSTHOG_HOST?.trim() || null;
}

/**
 * The project API key. Public by design: it ships in the browser bundle.
 *
 * Shape-checked, so a placeholder left in a deploy value reads as "not
 * configured" and sends nothing, rather than starting the client with a token
 * the instance rejects on every event.
 */
export function posthogKey(): string | null {
  const key = process.env.POSTHOG_KEY?.trim();
  return key && /^phc_[A-Za-z0-9]{20,}$/.test(key) ? key : null;
}

/**
 * On only when the flag is on AND a project key and host are configured, so a
 * deploy that has not been given them sends nothing rather than failing per page view.
 */
export function isAnalyticsEnabled(): boolean {
  return isFlagEnabled("ANALYTICS_ENABLED") && posthogKey() !== null && posthogHost() !== null;
}

/**
 * The pseudonymous id a person is known by in PostHog. Usage stays attributable
 * to one person over time, and no work address leaves the cluster.
 *
 * Prefixed before hashing so this id can never equal the attachment storage key
 * for the same person (`lib/attachments/store.ts`), which is derived the same way
 * and addresses their private files.
 */
export function analyticsIdFor(email: string): string {
  return createHash("sha256").update(`analytics:${email}`).digest("hex").slice(0, 32);
}
