/**
 * A tiny in-memory fixed-window rate limiter for HTTP endpoints. Used by the
 * external signed-link read path, and by the OIDC login and callback routes.
 * In-process only (no external store), which is enough for a single app
 * instance; a multi-instance deploy would swap in a shared store here.
 */

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __portalRateLimit?: Map<string, Map<string, Window>> };
const namespaces: Map<string, Map<string, Window>> = (g.__portalRateLimit ??= new Map());

/**
 * Hard cap on how many distinct keys a single namespace's map ever holds.
 * Without one, a caller that rotates its key on every request (an
 * `X-Forwarded-For` an attacker controls, see `clientKey` below) creates one
 * entry per request forever, and that namespace's map never shrinks on its
 * own. "Sane" here means large enough that a real deployment's distinct
 * callers do not collide with each other inside one window, not a tuned
 * production figure.
 *
 * The cap applies per namespace, not to the total across every namespace.
 * Every caller of `rateLimit` gets its own bounded map, keyed by the
 * `namespace` argument it passes: eviction pressure filling one namespace's
 * map can never touch another namespace's buckets. Sharing one map and one
 * cap across every caller (the external shared-doc link path, the OIDC login
 * route, and the OIDC callback route all called this function) meant FIFO
 * eviction at capacity could drop an active bucket belonging to a different
 * surface than the one that filled the map, renewing an allowance that
 * surface's own limit was supposed to keep exhausted. A `namespace` string is
 * enough to fix that: no class, no dependency, just one `Map` per namespace
 * instead of one `Map` total.
 */
export const MAX_RATE_LIMIT_BUCKETS = 10_000;

function bucketsFor(namespace: string): Map<string, Window> {
  let buckets = namespaces.get(namespace);
  if (!buckets) {
    buckets = new Map();
    namespaces.set(namespace, buckets);
  }
  return buckets;
}

function evictExpired(buckets: Map<string, Window>, now: number): void {
  for (const [key, window] of buckets) {
    if (now >= window.resetAt) buckets.delete(key);
  }
}

/**
 * Record one hit for `key` within `namespace` and report whether it is
 * allowed. Up to `limit` hits per `windowMs` succeed; the next hit in the
 * same window is refused (returns false) until the window rolls over. `now`
 * is injectable for tests.
 *
 * `namespace` scopes the bucket map: two callers using different namespaces
 * never share capacity, a bucket, or eviction pressure, even if they happen
 * to use the same `key` value.
 */
export function rateLimit(
  namespace: string,
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const buckets = bucketsFor(namespace);
  const existing = buckets.get(key);
  if (existing && now < existing.resetAt) {
    if (existing.count >= limit) return false;
    existing.count += 1;
    return true;
  }

  // A brand new key, or an expired window for this one. Only bother sweeping
  // once this namespace's map is actually at capacity: below the cap, every
  // insert is O(1) and no key ever grows the map without bound past
  // MAX_RATE_LIMIT_BUCKETS.
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    evictExpired(buckets, now);
  }
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    // Expired windows alone did not free enough room: every surviving bucket
    // is still live. Map iterates in insertion order, so the first key here
    // is the oldest one, evicted FIFO. No extra bookkeeping, no dependency.
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return true;
}

/** Clear every namespace's windows. Test-only seam so cases do not bleed into each other. */
export function resetRateLimits(): void {
  namespaces.clear();
}

/** Test-only seam: how many windows a given namespace currently tracks. */
export function bucketCount(namespace: string): number {
  return namespaces.get(namespace)?.size ?? 0;
}

/**
 * Identify the caller for rate-limiting purposes: the first entry of
 * `X-Forwarded-For`, which is the client as the ingress saw it.
 *
 * This value is only as trustworthy as whatever sits in front of this
 * process. It is a rate-limit key, never an identity and never an
 * authorization input: nothing here is verified, and a deployment with no
 * reverse proxy in front of it (or one that passes the header straight
 * through instead of overwriting it) lets any caller pick its own key by
 * sending whatever `X-Forwarded-For` value it likes, and rotating that value
 * on every request defeats this limiter entirely. For this key to mean
 * anything, the deployment's own ingress or reverse proxy must set
 * `X-Forwarded-For` itself from the connection it terminated, discarding or
 * overwriting any value a client sent rather than appending to it.
 *
 * Falls back to a single shared `unknown` bucket rather than to "unlimited",
 * so a deployment with no proxy in front of it is throttled as one caller
 * instead of not at all.
 */
export function clientKey(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}
