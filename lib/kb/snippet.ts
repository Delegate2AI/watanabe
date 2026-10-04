/**
 * Turning vault source into readable snippets.
 *
 * A grep-style backend hands back the raw source line it matched, so a search
 * for a colleague's name used to render `owner: maria.chen@example.com` and a
 * search inside an index note used to render a table row complete with pipes.
 * This module is the one place that reduces source to prose: strip the
 * frontmatter block, reduce markdown to plaintext, then window that plaintext
 * on the match. KB search and global search both route through it so there is a
 * single place to be wrong.
 *
 * Nothing here throws. Malformed markdown degrades to the closest readable
 * text, never an exception and never an empty string where a snippet was asked
 * for.
 */

export interface Snippet {
  /** The readable window, with a leading or trailing ellipsis when truncated. */
  text: string;
  /** Offsets of the matched term within `text`, for the UI to mark. Both 0 when the query was not locatable. */
  matchStart: number;
  matchEnd: number;
}

const DEFAULT_MAX_LEN = 160;
const ELLIPSIS = "…";

/**
 * Remove a leading `---` fenced frontmatter block, and only that. A `---`
 * horizontal rule in the body is content and survives, as does a document whose
 * opening fence is never closed (better to over-report than to eat the note).
 */
export function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  const closeIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closeIndex === -1) return text;
  return lines.slice(closeIndex + 2).join("\n");
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Drop a leading H1 whose text is the note's own title (whitespace-insensitive,
 * case-sensitive). The page header and the search result card both render the
 * title already, so the body repeating it reads as a stutter. Only the first
 * block qualifies: a matching H1 further down is a real section heading.
 */
export function dropTitleHeading(markdown: string, title?: string): string {
  if (!title) return markdown;
  const lines = markdown.split(/\r?\n/);
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first += 1;
  const heading = /^#\s+(.*?)\s*#*$/.exec(lines[first] ?? "");
  if (!heading || squeeze(heading[1]) !== squeeze(title)) return markdown;
  return lines.slice(first + 1).join("\n");
}

/** A `| --- | :--- |` table separator carries no content. */
function isTableDelimiter(line: string): boolean {
  return /^\s*\|[\s:|-]*$/.test(line) && line.includes("-");
}

/** A `---`, `***`, or `___` thematic break carries no content. */
function isThematicBreak(line: string): boolean {
  return /^\s*([-*_])\1{2,}\s*$/.test(line);
}

function isCodeFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** `| a | b |` becomes `a b`. */
function flattenTableRow(line: string): string {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(" ");
}

/** `[[dir/note#heading|Alias]]` becomes `Alias`, `[[dir/note]]` becomes `note`. */
function reduceWikilink(target: string): string {
  const [pathPart, alias] = target.split("|");
  if (alias && alias.trim() !== "") return alias.trim();
  const withoutAnchor = pathPart.split("#")[0].trim();
  const segments = withoutAnchor.split("/").filter((part) => part !== "" && part !== "..");
  return (segments[segments.length - 1] ?? withoutAnchor).replace(/\.md$/i, "");
}

function reduceInline(line: string): string {
  return (
    line
      // Embeds first, so `![[note]]` reduces as a wikilink and not as an image.
      .replace(/!\[\[/g, "[[")
      .replace(/\[\[([^\]]+)\]\]/g, (_all, target: string) => reduceWikilink(target))
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/`/g, "")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
      // A lone hyphen between words separates a list item's link from its gloss
      // ("tokenomics - emission curves"); it is punctuation, not prose.
      .replace(/\s+-\s+/g, " ")
  );
}

/**
 * Drop HTML comments, which a reader never sees in the rendered note either
 * (the renderers skip raw HTML, see lib/markdown/shared.tsx). Done before the
 * line loop because a comment spans lines: vault notes carry KB-TAG metadata
 * blocks that way, and the per-line tag strip in `reduceInline` cannot match
 * across them, so the whole block used to surface as search-snippet prose. An
 * unterminated `<!--` swallows the rest of the source, which is what CommonMark
 * does with it too.
 */
function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!--[\s\S]*$/, " ");
}

/**
 * Reduce markdown to the plaintext a reader would see: headings lose their
 * markers, tables lose their pipes, links and wikilinks reduce to their label,
 * emphasis markers drop, and whitespace collapses to single spaces.
 */
export function toPlainText(markdown: string): string {
  const out: string[] = [];
  for (const raw of stripComments(markdown).split(/\r?\n/)) {
    if (isCodeFence(raw) || isTableDelimiter(raw) || isThematicBreak(raw)) continue;
    const stripped = raw
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
    out.push(reduceInline(stripped.trim().startsWith("|") ? flattenTableRow(stripped) : stripped));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The head of the text, snapped back to a word boundary when it has to be cut. */
function head(source: string, maxLen: number): Snippet {
  if (source.length <= maxLen) return { text: source, matchStart: 0, matchEnd: 0 };
  const cut = source.lastIndexOf(" ", maxLen);
  const end = cut > maxLen / 2 ? cut : maxLen;
  return { text: `${source.slice(0, end).trimEnd()} ${ELLIPSIS}`, matchStart: 0, matchEnd: 0 };
}

/**
 * Where the window should begin: the start of the sentence containing the match
 * when one begins inside the window, otherwise the next word boundary, so a
 * snippet never opens mid-word.
 */
function snapStart(source: string, rough: number, matchIndex: number): number {
  if (rough <= 0) return 0;
  const lead = source.slice(rough, matchIndex);
  const sentence = lead.search(/[.!?]\s(?=[^.!?]*$)/);
  if (sentence !== -1) return rough + sentence + 2;
  const space = source.indexOf(" ", rough);
  return space !== -1 && space < matchIndex ? space + 1 : rough;
}

/**
 * A readable window of `text` centered on the first case-insensitive occurrence
 * of `query`, snapped to sentence or word boundaries, with the match's offsets
 * so the caller can mark it. `text` is expected to be plaintext already (run it
 * through `stripFrontmatter` then `toPlainText`).
 *
 * When the query cannot be located (a stemmed or multi-token backend match) the
 * head of the text comes back with zeroed offsets, never an empty snippet.
 */
export function snippetFor(text: string, query: string, maxLen = DEFAULT_MAX_LEN): Snippet {
  const source = text.trim();
  if (source === "") return { text: "", matchStart: 0, matchEnd: 0 };

  const needle = query.trim();
  const match = needle === "" ? null : new RegExp(escapeRegExp(needle), "i").exec(source);
  if (!match) return head(source, maxLen);

  const matchIndex = match.index;
  const matchLen = match[0].length;
  if (source.length <= maxLen) {
    return { text: source, matchStart: matchIndex, matchEnd: matchIndex + matchLen };
  }

  // A match longer than the window makes (maxLen - matchLen) negative, which
  // pushes the window start PAST the match: matchStart comes back negative and
  // the highlight lands on unrelated tail text. Clamp so the window always
  // begins at or before the match.
  const centered = matchIndex - Math.floor(Math.max(0, maxLen - matchLen) / 2);
  const rough = Math.max(0, Math.min(centered, source.length - maxLen, matchIndex));
  const start = snapStart(source, rough, matchIndex);

  let end = Math.min(source.length, start + maxLen);
  if (end < source.length) {
    const space = source.lastIndexOf(" ", end);
    if (space > matchIndex + matchLen) end = space;
  }

  const prefix = start > 0 ? `${ELLIPSIS} ` : "";
  const suffix = end < source.length ? ` ${ELLIPSIS}` : "";
  const body = source.slice(start, end).trimEnd();
  const rendered = `${prefix}${body}${suffix}`;
  // A match longer than the window is truncated by it, so the highlight has to
  // stop at the text it actually has. Offsets that run past the end would make
  // the caller slice out of bounds.
  const matchStart = Math.max(0, Math.min(prefix.length + matchIndex - start, rendered.length));
  return {
    text: rendered,
    matchStart,
    matchEnd: Math.min(matchStart + matchLen, rendered.length),
  };
}
