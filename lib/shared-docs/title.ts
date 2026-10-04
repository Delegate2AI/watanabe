/** Titles for shared documents, bounded the same way on both creation paths. */

/** The hard bound on a shared document's title, matching the create route's schema. */
export const MAX_TITLE = 120;

/** Trim to `MAX_TITLE` without leaving a trailing space. */
export function boundTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_TITLE ? trimmed.slice(0, MAX_TITLE).trim() : trimmed;
}

/** The first non-empty line without its `#` markers. Empty if there is none. */
export function firstLineTitle(body: string): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").trim() ?? "";
  return boundTitle(firstLine);
}

/** A bounded title: the explicit one, else the body's first line, else `fallback`. */
export function deriveTitle(title: string | undefined, body: string, fallback = "Untitled document"): string {
  const explicit = title?.trim();
  if (explicit) return boundTitle(explicit);
  return firstLineTitle(body) || fallback;
}
