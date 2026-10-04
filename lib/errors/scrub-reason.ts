/**
 * A loader/installer reason, made safe to put in a response body.
 *
 * Registry and install reasons are the most useful thing an admin surface can
 * show (a missing `SKILL.md`, a ref that does not exist, a zip entry that tried
 * to escape, a YAML parse error naming a line), and they are also the one place
 * absolute server paths appear: staging directories are named in `ENOENT` text
 * and in traversal refusals. Absolute paths are replaced rather than the whole
 * sentence dropped. The lookbehind keeps an admin's own `https://host/path`
 * intact, since only a slash that does not follow a word character, a colon, or
 * another slash starts a filesystem path.
 *
 * Shared by the skills and connectors admin surfaces so neither can be the one
 * that forwards loader text verbatim.
 */
const ABSOLUTE_PATH_RE = /(?<![\w:/])(?:[A-Za-z]:\\|\/)[^\s"'`,)]*/g;

export function scrubReason(reason: string): string {
  return reason
    .replace(/\s+/g, " ")
    .trim()
    .replace(ABSOLUTE_PATH_RE, "<path>")
    .slice(0, 300);
}
