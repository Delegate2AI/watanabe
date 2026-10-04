import { randomUUID } from "node:crypto";
import type { LinkAccess } from "./types";

/**
 * External signed-link helpers (spec 28). A link is the ONLY unauthenticated
 * read surface, so its token must be unguessable and it must be bounded in time.
 */

/** Default lifetime for a freshly minted external link, when none is specified. */
export const DEFAULT_LINK_TTL_HOURS = 168; // 7 days

/** The widest lifetime an owner may request; keeps the external surface bounded. */
export const MAX_LINK_TTL_HOURS = 24 * 90; // 90 days

/**
 * A cryptographically strong, unguessable token: `randomUUID()` is 122 bits of
 * CSPRNG entropy, NOT a sequential id, so a token cannot be guessed or walked and
 * does not encode the doc id or owner. The token IS the credential; it is stored
 * verbatim as the `doc_links` primary key and matched exactly at resolve time.
 */
export function newLinkToken(): string {
  return randomUUID();
}

/**
 * The absolute `expires_at` for a link minted `now`, `ttlHours` from now. A link
 * always expires (defaulting to {@link DEFAULT_LINK_TTL_HOURS}); the TTL is
 * clamped to {@link MAX_LINK_TTL_HOURS} so an owner cannot mint an effectively
 * permanent external link. Returns an ISO string.
 */
export function computeExpiry(now: Date = new Date(), ttlHours: number = DEFAULT_LINK_TTL_HOURS): string {
  const hours = Math.min(Math.max(1, Math.floor(ttlHours)), MAX_LINK_TTL_HOURS);
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** Narrow an arbitrary string to a link capability (view|comment), else null. */
export function asLinkAccess(value: unknown): LinkAccess | null {
  return value === "view" || value === "comment" ? value : null;
}
