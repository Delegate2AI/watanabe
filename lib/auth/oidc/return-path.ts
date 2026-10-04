/**
 * Where to send someone after a successful sign-in.
 *
 * The value arrives as a query parameter and comes back out of a cookie, so it
 * is attacker-controlled twice over. Anything that is not an unambiguous
 * same-origin path becomes `/`. `//evil.example` is the case worth naming: it
 * starts with a slash and is a protocol-relative URL, so a naive "starts with /"
 * check hands an open redirect to whoever asks.
 */

export const RETURN_COOKIE = "portal_oidc_return";

const DEFAULT_PATH = "/";
const MAX_LENGTH = 4096;

export function safeReturnPath(raw: string | null | undefined): string {
  // Next's actual runtime type for a repeated query parameter is `string[]`,
  // which this signature does not admit but a caller can still hand us (see
  // app/login/page.tsx). Guarding on `typeof` here means the validator is safe
  // on its own, rather than depending on every caller to normalize first.
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return DEFAULT_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_PATH;
  try {
    // The base is a throwaway: parsing normalizes the path and strips the
    // fragment, and any absolute URL was already rejected above.
    const parsed = new URL(raw, "https://portal.invalid");
    // Re-check the NORMALIZED path, not just the raw input. Dot segments
    // collapse during parsing, so "/.//evil.example" passes the raw check
    // above and arrives here as "//evil.example", which is protocol-relative
    // and resolves to another origin the moment it is used as a redirect.
    if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
      return DEFAULT_PATH;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_PATH;
  }
}
