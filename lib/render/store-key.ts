import { createHash } from "node:crypto";

/**
 * The owner+document identity used both as a storage path segment and as the
 * render scheduler's debounce key.
 *
 * A SHA-256 of the raw email rather than a slug, matching
 * `lib/attachments/store.ts`: a slug collapses `a.b@x.com` and `a-b@x.com` onto
 * one value, which as a path would put one person's documents in another
 * person's folder and as a debounce key would let one person's save cancel
 * another's render.
 *
 * Its own module so `lib/render/schedule.ts` can key on it without importing the
 * filesystem store.
 */

export function ownerKey(ownerEmail: string): string {
  return createHash("sha256").update(ownerEmail).digest("hex").slice(0, 32);
}

/**
 * Collapse a document id to a safe, single-level, COLLISION-FREE name.
 *
 * A readable prefix for a human looking at the directory, plus a hash of the
 * whole id so two ids cannot land on one folder.
 *
 * The hash is not decoration. A pure sanitize maps `a/b` and `a?b` both onto
 * `a-b`, and truncating at 128 characters merges any two ids sharing a prefix,
 * so one document's PDF was served for another's. Verified by the Codex review,
 * which wrote both ids and read the second document's bytes back for the first.
 */
export function safeSegment(value: string): string {
  const readable = value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 48);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return readable ? `${readable}-${digest}` : digest;
}

export function renderStoreKey(ownerEmail: string, docId: string): string {
  return `${ownerKey(ownerEmail)}/${safeSegment(docId)}`;
}
