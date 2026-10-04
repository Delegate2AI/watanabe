/**
 * Normalization + relocation shared by the two context resolvers
 * (`./context-resolve.ts` for vault selections, `./context-resolve-shared-doc.ts`
 * for shared-doc selections), split out so neither imports the other.
 */

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Strips common inline markdown syntax (blockquote `>` prefixes, bold,
 * italic, inline code, link brackets) so a raw markdown source line can be
 * compared against what the BROWSER actually selected — `selection.toString()`
 * returns rendered plain text (no `**`/`>`/`[]()`  markers), so comparing it
 * directly against unstripped markdown source would spuriously mismatch on
 * any formatted line (bold, a link, a blockquote) and fall through to the
 * `client` provenance fallback even when the selection is legitimate and
 * unchanged. The excerpt actually sent to the model is always the ORIGINAL,
 * unstripped markdown — this stripping exists only for the comparison.
 */
export function stripMarkdownSyntax(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}>+\s?/, ""))
    .join("\n")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*?)`{1,3}/g, "$1")
    .replace(/(\*\*\*|___)([^*_]+?)\1/g, "$2")
    .replace(/(\*\*|__)([^*_]+?)\1/g, "$2")
    .replace(/(\*|_)([^*_]+?)\1/g, "$2");
}

export function normalizeForComparison(text: string): string {
  return normalizeWhitespace(stripMarkdownSyntax(text));
}

const MAX_RELOCATE_WINDOW_LINES = 200;

/**
 * Whitespace-normalized substring relocation: the selection's line range may
 * have drifted (someone edited the file between page load and send). Scans
 * for a contiguous run of lines whose normalized, space-joined text matches
 * the client's normalized `selectedText` exactly. Bounded window per start
 * line and early-exit once the accumulated text has clearly overshot, so
 * this stays cheap on realistically-sized KB pages.
 */
export function relocate(lines: string[], normalizedSelected: string): { startLine: number; endLine: number } | null {
  for (let start = 0; start < lines.length; start++) {
    // A candidate start can't be a blank line: normalizeWhitespace() trims,
    // so a leading blank line would otherwise be silently absorbed and
    // produce a false match starting one (or more) lines too early.
    if (lines[start].trim() === "") continue;
    const limit = Math.min(lines.length, start + MAX_RELOCATE_WINDOW_LINES);
    let raw = lines[start];
    for (let end = start; end < limit; end++) {
      if (end > start) raw += `\n${lines[end]}`;
      // Re-normalize the whole growing raw slice each time (not an
      // incremental per-line join) so this matches EXACTLY how the
      // "verified" case normalizes `rawExtract` — a blank line inside the
      // window must collapse the same way it would in a real selection's
      // own normalizeForComparison(), not introduce a spurious extra space.
      const acc = normalizeForComparison(raw);
      if (acc === normalizedSelected) return { startLine: start + 1, endLine: end + 1 };
      if (acc.length > normalizedSelected.length + 200) break; // overshot — this start line can't match
    }
  }
  return null;
}
