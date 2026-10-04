/**
 * Diff-scoped mechanical quality checks for the knowledge-base write path
 * (spec 12, subsystem B2). Pure functions, no I/O: `addedLinesFromDiff` parses
 * a unified diff for ADDED lines only (legacy prose in unchanged lines is
 * grandfathered, per B1), and `checkAddedLines` runs a small set of
 * deterministic writing rules ported from research-harness's
 * check-em-dash.py / check-prose.py hooks against them.
 */

export interface AddedLine {
  line: number;
  text: string;
}

export type ViolationKind = "em-dash" | "unsourced-figure" | "time-estimate";

export interface Violation {
  line: number;
  kind: ViolationKind;
  message: string;
  excerpt: string;
}

// research-harness's check-em-dash.py bans em dash (U+2014) and horizontal
// bar (U+2015), deliberately NOT en dash (U+2013, allowed in numeric ranges
// such as "10 to 12" written with a dash, and would produce too many false
// positives). Built from code points, not a literal character, so this
// source file itself stays free of the banned glyphs.
const BANNED_DASH_CHARS = String.fromCodePoint(0x2014, 0x2015);
const EM_DASH_RE = new RegExp(`[${BANNED_DASH_CHARS}]`);

// research-harness's check-prose.py R14 flags every bare "N days"/"N months",
// including ordinary calendar durations, because it runs advisory only (a
// human reviews the hint). Here the same rule hard-blocks a stage (B2), so it
// is narrowed twice over from that source rule:
//   1. Only fires on planning/estimation framing (the CLAUDE.md rule this
//      enforces is about *estimating* work effort), not on a bare calendar
//      duration with no framing at all ("the 3 months ending in March").
//   2. Never fires on a historical past-tense "took": "the migration took 2
//      weeks" reports a fact, it does not estimate one. The "took" veto is
//      applied to the whole line, not just the local match, because a
//      nearby "about"/"roughly"/"~" reads as part of the same historical
//      clause ("it took about 3 months for rates to fall" is one statement,
//      not an estimate wearing a "took" disguise). See `isWorkEffortEstimate`.
//
// The leading `(?:^|\B)` on the "~" branch (instead of `\b~`) is deliberate:
// `\b` can never match immediately before "~", since neither a preceding
// space/punctuation nor "~" itself is a word character, so `\b~` would never
// match anywhere ("~3 days" included) and the whole branch would be dead
// code. `\B` (a non-boundary) matches between two non-word characters, which
// is exactly the case right before "~" when it follows whitespace,
// punctuation, or the start of the line.
const TIME_ESTIMATE_RE =
  /(?:\b(?:will\s+take|should\s+take|expect(?:s|ed)?\s+to\s+take|takes?|estimated(?:\s+at)?|about|roughly)\s*|(?:^|\B)~\s*)\d+\s*(?:hour|day|week|month)s?\b/i;
const HISTORICAL_TOOK_RE = /\btook\b/i;

// research-harness's check-prose.py R2 (unsourced figure): a percentage or
// round-number suffix. The trailing \b is only applied to word-like suffixes
// ("percent"/"k"/"m"/"bn"/"billion"/"million") since \b can never match right
// after a symbol like "%" (neither side is a word character there).
//
// SCOPE DECISION: this mechanical (hard-blocking) check covers only
// unit-suffixed figures (%, $, k/m/bn/billion/million/percent). A bare large
// number with no unit ("2400", "1.5") is deliberately NOT flagged here: at
// hard-block granularity it would trip on years, item counts, section
// numbers, and phone numbers far more often than it would catch a real
// unsourced statistic. Bare-number sourcing is left to the advisory
// citation-checker agent (spec 12, task 12), which can weigh surrounding
// context before deciding a number needs a source. This is a deliberate
// scope split, not an omission.
const FIGURE_RE = /\b\d[\d,.]*\s?(?:%|percent\b|k\b|m\b|bn\b|billion\b|million\b)/i;
const DOLLAR_RE = /\$\s?\d/;

// A citation on the line: a markdown link/source marker (leading "["), a URL,
// or a bare (optionally backtick-wrapped) vault-relative path with a file
// extension, e.g. "04-economy/rev.md" or `04-economy/rev.md`.
const CITATION_MARK_RE = /\[|http/i;
const PATH_RE = /[^\s()<>`]+\/[^\s()<>`]*\.\w{2,5}\b/;

const CODE_SPAN_RE = /`[^`]*`/g;

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function excerptOf(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
}

function hasCitation(text: string): boolean {
  return CITATION_MARK_RE.test(text) || PATH_RE.test(text);
}

/** True if `text`, with any inline code spans removed, still carries a bare figure. */
function hasUnsourcedShapeFigure(text: string): boolean {
  const prose = text.replace(CODE_SPAN_RE, "");
  return FIGURE_RE.test(prose) || DOLLAR_RE.test(prose);
}

/**
 * True if `text` reads as a work-effort estimate (see the SCOPE DECISION
 * comment on `TIME_ESTIMATE_RE`): the estimation-framing regex matches, the
 * line is not a historical "took" statement, and the line is not itself
 * citing a source for a real elapsed-time fact.
 */
function isWorkEffortEstimate(text: string): boolean {
  return TIME_ESTIMATE_RE.test(text) && !HISTORICAL_TOOK_RE.test(text) && !hasCitation(text);
}

/**
 * Runs the mechanical rule set over `addedLines` (already-extracted ADDED
 * lines, e.g. from `addedLinesFromDiff`). `line` in each returned Violation
 * is the 1-based position within `addedLines`, not a file line number; the
 * caller maps that back to a real file line (e.g. via `addedLinesFromDiff`'s
 * own `line` field for the same index).
 */
export function checkAddedLines(addedLines: string[]): Violation[] {
  const violations: Violation[] = [];

  addedLines.forEach((text, i) => {
    const line = i + 1;

    if (EM_DASH_RE.test(text)) {
      violations.push({
        line,
        kind: "em-dash",
        message: "Em dash (or horizontal bar) found; replace with a comma, parentheses, two sentences, a colon, or 'vs./or/to'.",
        excerpt: excerptOf(text),
      });
    }

    if (isWorkEffortEstimate(text)) {
      violations.push({
        line,
        kind: "time-estimate",
        message: "Work-effort time estimate found; use file/line/item counts instead of hours/days/weeks/months.",
        excerpt: excerptOf(text),
      });
    }

    if (hasUnsourcedShapeFigure(text) && !hasCitation(text)) {
      violations.push({
        line,
        kind: "unsourced-figure",
        message: "Figure with no citation on the line; add a source link, path, or URL.",
        excerpt: excerptOf(text),
      });
    }
  });

  return violations;
}

/**
 * Parses a unified diff and returns every ADDED line (lines starting with
 * "+", excluding the "+++ b/..." file header) with its NEW-file line number,
 * tracked from the "@@ -a,b +c,d @@" hunk headers.
 *
 * Parsing is gated on hunk state (`inHunk`), not on a bare `raw.startsWith`
 * check: "---"/"+++ " file headers only ever appear before the first "@@" of
 * a file section. Testing for them unconditionally misparses an ADDED
 * content line that itself happens to start with "++" (e.g. prose discussing
 * "C++", which renders as the diff line "+" + "++i is a C++ idiom") as a
 * "+++" file header, silently dropping the line and shifting every
 * subsequent new-file line number. Once `inHunk` is true, any "+"-prefixed
 * line is content, any "-"-prefixed line is a removed line (skip, does not
 * advance the new-file counter), and anything else is context (advance the
 * counter, do not emit).
 */
export function addedLinesFromDiff(unifiedDiff: string): AddedLine[] {
  const result: AddedLine[] = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of unifiedDiff.split("\n")) {
    const hunk = HUNK_HEADER_RE.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      inHunk = false; // new file section; its own "---"/"+++ " headers come next
      continue;
    }
    if (!inHunk) continue; // pre-hunk section noise: "---"/"+++ " headers, "index ...", etc.
    if (raw.startsWith("+")) {
      result.push({ line: newLine, text: raw.slice(1) });
      newLine++;
      continue;
    }
    if (raw.startsWith("-")) continue; // removed line, absent from the new file
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (newLine > 0) newLine++; // context line, present in both old and new
  }

  return result;
}
