import { createHash } from "node:crypto";

/**
 * The opaque key a person's page is addressed by.
 *
 * `/people/<url-encoded email address>` put a colleague's address into the URL
 * bar, and from there into browser history, the referrer of anything that page
 * links out to, server and proxy access logs, and any link anybody pastes into
 * a chat. None of those need it: the page already resolves the person from the
 * viewer's own roster, so the identifier only has to be stable and unique.
 *
 * Not a security boundary and not pretending to be one. The roster check in
 * `personDetail` is what stops a viewer reading someone they are not cleared
 * for, and that is unchanged; a short digest of a known address is guessable by
 * anyone who already has the address. The point is narrower: stop emitting the
 * address in a place that gets copied, logged and forwarded.
 *
 * Server-only (node crypto). Compute it where the row is rendered and pass it
 * down; a client island must never try to derive one.
 */
export function personSlug(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
