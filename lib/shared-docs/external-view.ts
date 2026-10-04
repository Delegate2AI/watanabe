import type { Database as DatabaseType } from "better-sqlite3";
import { getSharedDoc, latestVersionOf, listComments } from "@/lib/db/shared-docs";
import type { DocFormat } from "@/lib/documents/types";
import type { DocComment, LinkAccess } from "./types";
import { accessForToken } from "./access";
import { isExternalShareEnabled } from "./config";
import { rateLimit } from "./rate-limit";

/**
 * The external (token-authed, no-session) read path resolver (spec 28). This is
 * the ONLY unauthenticated surface, so it is deliberately conservative:
 *
 *  - It is dark unless `EXTERNAL_SHARE_ENABLED` (and shared docs) are on.
 *  - It is rate-limited BEFORE the token is even looked at, so a throttle
 *    response is identical for a valid and an invalid token (no oracle) and a
 *    token cannot be brute-force walked.
 *  - An unknown, revoked, or expired token all resolve to `not-found`
 *    identically. The result never carries the doc id or owner email.
 *  - The capability is view|comment ONLY (it comes from the link, which the
 *    schema forbids from ever being edit), so there is no edit path here.
 */

export const EXTERNAL_RATE_LIMIT = 30;
export const EXTERNAL_RATE_WINDOW_MS = 60_000;

export type ExternalView =
  | { status: "unavailable" }
  | { status: "rate-limited" }
  | { status: "not-found" }
  | {
      status: "ok";
      title: string;
      body: string;
      /** Which renderer the body needs. An HTML body is a whole designed page. */
      format: DocFormat;
      access: LinkAccess;
      comments: DocComment[];
    };

export function resolveExternalView(
  db: DatabaseType,
  token: string,
  clientKey: string,
  now: Date = new Date(),
): ExternalView {
  if (!isExternalShareEnabled()) return { status: "unavailable" };
  // Own namespace ("docs-link"), so this surface's buckets can never be
  // evicted by, or evict, the OIDC login or callback routes' own limits.
  if (!rateLimit("docs-link", clientKey, EXTERNAL_RATE_LIMIT, EXTERNAL_RATE_WINDOW_MS, now.getTime())) {
    return { status: "rate-limited" };
  }
  const resolved = accessForToken(db, token, now.toISOString());
  if (!resolved) return { status: "not-found" };
  const doc = getSharedDoc(db, resolved.docId);
  if (!doc) return { status: "not-found" };
  const latest = latestVersionOf(db, resolved.docId);
  return {
    status: "ok",
    title: doc.title,
    body: latest?.body ?? "",
    format: latest?.format ?? "md",
    access: resolved.access,
    // A comment-capability link may see the thread; a view link never does.
    comments: resolved.access === "comment" ? listComments(db, resolved.docId) : [],
  };
}
