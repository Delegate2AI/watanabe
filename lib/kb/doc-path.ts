/**
 * Map a KB document path (as it appears in an inline code span, e.g.
 * `00-overview/executive-summary.md`) to this app's `/kb` route, or null when
 * the text is not a doc-path-shaped reference.
 *
 * The `/kb` route tree is rooted at the vault (`docs/`), and its canonical page
 * routes are extensionless, so `00-overview/executive-summary.md` maps to
 * `/kb/00-overview/executive-summary`. A leading `docs/` is dropped (the vault
 * root already IS docs/), as is a leading `./` or `/`.
 *
 * Linking is OPTIMISTIC and clearance-safe: this never checks whether the
 * target exists or is readable. A path the requester is not cleared for (or that
 * simply does not exist) is absent from their `/kb` projection and 404s on
 * click, exactly like typing the URL. Existence is never revealed at render
 * time, so there is nothing to leak.
 */
export function kbDocHref(text: string): string | null {
  const t = text.trim();
  // A path-shaped token ending in `.md`, no whitespace or backticks. Anything
  // with a space (prose, a sentence) is not a path and is left as plain code.
  if (!/^[^\s`]+\.md$/i.test(t)) return null;

  const rel = t
    .replace(/^\.?\/+/, "") // drop a leading ./ or /
    .replace(/^docs\//i, "") // the vault root IS docs/
    .replace(/\.md$/i, ""); // canonical /kb routes are extensionless

  if (!rel || rel.startsWith("..")) return null; // no traversal, no empty
  return `/kb/${rel.split("/").map(encodeURIComponent).join("/")}`;
}
