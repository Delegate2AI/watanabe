/**
 * Cookie serialization and reading, done by hand.
 *
 * `next/headers`'s `cookies()` needs Next's async request store, which makes
 * every consumer untestable without a request context and unusable from a plain
 * `HeaderSource`. These two functions work anywhere a `Set-Cookie` string or a
 * `Cookie` header does, which includes route handlers, the auth strategies, and
 * a vitest case with no Next runtime at all.
 */

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
}

const SAME_SITE_LABEL = { lax: "Lax", strict: "Strict", none: "None" } as const;

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path !== undefined) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${SAME_SITE_LABEL[options.sameSite]}`);
  return parts.join("; ");
}

/** Same shape as `serializeCookie`, with the value and lifetime that clear it. */
export function expireCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    // Exact name match, so `not_portal_session` never answers for `portal_session`.
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length === 0) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is a broken cookie, not a crash.
      return null;
    }
  }
  return null;
}
