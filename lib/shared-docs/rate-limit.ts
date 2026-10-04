/**
 * Moved to `lib/http/rate-limit.ts` when the OIDC login route became a second
 * caller. Re-exported here so spec 28's imports and behavior are unchanged.
 */
export { rateLimit, resetRateLimits } from "@/lib/http/rate-limit";
