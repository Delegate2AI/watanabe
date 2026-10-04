/**
 * Which markdown constructs the rich (WYSIWYG) editor cannot represent.
 *
 * The rich editor is a ProseMirror document: markdown goes in through
 * `tiptap-markdown`, and whatever the schema could not hold is gone by the time
 * it serializes back out. That is silent data loss, so a body carrying one of
 * these constructs is edited in markdown mode only.
 *
 * Every entry here is measured, not guessed. `rich-fidelity.roundtrip.test.ts`
 * runs each one through the real editor and asserts the loss still happens: if a
 * future extension makes one of them survive, that test fails and the blocker
 * should be removed rather than left to refuse a body it could now handle.
 */
export type RichBlocker =
  | "table"
  | "image"
  | "taskList"
  | "html"
  | "frontmatter"
  | "footnote"
  | "callout"
  | "fenceInfo"
  | "fenceNested";

/** Reader-facing reason, phrased to complete "... cannot be edited in rich mode". */
export const RICH_BLOCKER_LABELS: Record<RichBlocker, string> = {
  table: "a table",
  image: "an image",
  taskList: "a checklist",
  html: "raw HTML",
  frontmatter: "frontmatter",
  footnote: "a footnote",
  callout: "a callout",
  fenceInfo: "a code block with extra info",
  fenceNested: "a code block quoting another code block",
};

/** YAML frontmatter, which only counts as frontmatter at the very top of the body. */
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;
/** A GFM delimiter row (`| --- | :---: |`), the line that makes the row above a header. */
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;
/**
 * Any image, in every form: inline `![alt](src)` and all three reference forms
 * (`![alt][ref]`, `![alt][]`, `![alt]`). All of them serialize back as nothing
 * at all, so the opening `![` is the only marker worth matching.
 *
 * The `(?:\\\\)*` run matters: one backslash escapes the `!` and leaves literal
 * text, but two backslashes are an escaped backslash and the image is real
 * again, so only an ODD run before `![` means "not an image".
 */
const IMAGE = /(?:^|[^\\])(?:\\\\)*!\[/;
/**
 * A checklist item under a bullet (`- [ ]`) or an ordered (`1. [ ]`, `1) [ ]`)
 * marker. The marker group repeats, because a list nested directly inside
 * another (`- - [ ] todo`) puts two of them on one line.
 */
const TASK_ITEM = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+\[[ xX]\][ \t]/m;
/** An HTML tag. Autolinks (`<https://x>`, `<a@b.c>`) fail it: no tag name can hold a colon or an @. */
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*([ \t\r\n][^<>]*)?\/?>/;
/** Comments, doctypes, CDATA and processing instructions, which come back entity-escaped. */
const HTML_DECLARATION = /<[!?]/;
const FOOTNOTE = /\[\^[^\]\s]+\]/;
/**
 * An Obsidian callout marker, matched against a quoted line's content (see
 * `scan`, which strips the `>` prefix). The serializer escapes both brackets
 * (`\[!warning\]`) AND collapses the soft break that separates the title from
 * the body, so the construct comes back as a plain quote of literal text.
 *
 * Matched per quoted line rather than only at the start of a quote: a marker
 * further down a blockquote is not a callout to the renderer
 * (lib/markdown/callouts.ts reads the first paragraph only), so this
 * over-refuses slightly. Refusing rich mode for a body that would survive is
 * a recoverable annoyance; accepting one that silently loses a callout is not.
 */
const CALLOUT = /^[ \t]*\[!([A-Za-z][\w-]*)\][+-]?/;
/**
 * An opening fence, capturing the delimiter run and the info string. A single
 * language token survives; anything after it (```` ```ts title=setup.ts ````)
 * is dropped, and a run longer than three backticks is re-emitted as three,
 * which splits a block that was using the longer run to quote a shorter one.
 *
 * A backtick fence's info string may not itself contain a backtick (CommonMark
 * 4.5), so ```` ```code``` ```` opens nothing: it is an inline code span on a
 * line of prose, and treating it as a fence blinded the scan to everything
 * below it.
 */
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*(.*)$/;

function isFenceOpener(delim: string, info: string): boolean {
  return delim[0] !== "`" || !info.includes("`");
}
/**
 * An inline code span, matched by its whole delimiter run so a `` `` ``-quoted
 * `![image]` or `<tag>` is recognised as code rather than left to trip a
 * blocker. Neither delimiter may be backslash-escaped: escaped backticks are
 * literal text, and whatever sits between them is real markup.
 */
const CODE_SPAN = /(^|[^\\])(`+)[^\n]*?(?<!\\)\2/g;
/** Blockquote markers, which prefix a line without changing what is on it. */
const QUOTE_PREFIX = /^(?:[ \t]*>)+[ \t]?/;

interface Scanned {
  /** The body with code blocks and code spans blanked out, line count preserved. */
  prose: string;
  /** Whether any fence carried more than a bare language in its info string. */
  fenceInfo: boolean;
  /** Whether any fence used a delimiter run longer than the three the serializer emits. */
  fenceNested: boolean;
  /** Whether any quoted line outside a fence opens with a callout marker. */
  callout: boolean;
}

/**
 * Blank out fenced code blocks and inline code spans, keeping the line count so
 * a later line-based check still reports on the right structure. A table drawn
 * inside a fence is sample text, not a table, and `` `a | b` `` is prose.
 *
 * Blockquote markers come off first, and leading indentation is ignored by the
 * patterns, because a table or checklist nested in a quote or under a list item
 * is destroyed exactly like one at the top level.
 */
function scan(markdown: string): Scanned {
  let fence: string | null = null;
  let fenceInfo = false;
  let fenceNested = false;
  let callout = false;
  const prose = markdown.split("\n").map((raw) => {
    const line = raw.replace(QUOTE_PREFIX, "");
    const delim = FENCE.exec(line);
    const opens = delim !== null && isFenceOpener(delim[1], delim[2]);
    if (fence === null) {
      if (delim && opens) {
        fence = delim[1];
        if (delim[1].length > 3) fenceNested = true;
        // ```ts is fine; ```ts title=x loses everything after the language.
        if (/\s/.test(delim[2].trim())) fenceInfo = true;
        return "";
      }
      const text = line.replace(CODE_SPAN, "$1");
      // The quote marker has to come off `raw` and the marker has to be tested
      // on the code-span-stripped text: only a QUOTED `[!kw]` is a callout, and
      // a backticked one is prose about callouts.
      if (QUOTE_PREFIX.test(raw) && CALLOUT.test(text)) callout = true;
      return text;
    }
    // Only a run of the SAME character, at least as long as the opener, closes
    // it: inside ````, a bare ``` line is quoted content, not the end.
    if (delim && delim[1][0] === fence[0] && delim[1].length >= fence.length) fence = null;
    return "";
  });
  return { prose: prose.join("\n"), fenceInfo, fenceNested, callout };
}

/**
 * The first construct in `markdown` that the rich editor would destroy, or
 * `null` when the whole body is safe to round-trip.
 */
export function richEditorBlocker(source: string): RichBlocker | null {
  // Windows line endings first: every check below is anchored, and a trailing
  // `\r` on each line defeated all of them.
  const markdown = source.replace(/\r\n?/g, "\n");
  if (FRONTMATTER.test(markdown)) return "frontmatter";

  const { prose, fenceInfo, fenceNested, callout } = scan(markdown);
  const lines = prose.split("\n");
  for (let i = 1; i < lines.length; i++) {
    // A delimiter row is only a table when the line above is the header row,
    // which by GFM must carry at least one pipe. Without that check a plain
    // `---` thematic break reads as a one-column table.
    if (TABLE_DELIMITER.test(lines[i]) && lines[i].includes("|") && lines[i - 1].includes("|")) {
      return "table";
    }
  }
  // HTML first: `<![CDATA[` opens with the same `![` an image does, and reading
  // it as an image would name the wrong reason on screen.
  if (HTML_TAG.test(prose) || HTML_DECLARATION.test(prose)) return "html";
  if (IMAGE.test(prose)) return "image";
  if (TASK_ITEM.test(prose)) return "taskList";
  if (FOOTNOTE.test(prose)) return "footnote";
  if (callout) return "callout";
  if (fenceInfo) return "fenceInfo";
  if (fenceNested) return "fenceNested";
  return null;
}
