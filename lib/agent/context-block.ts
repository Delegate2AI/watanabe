import {
  CONTEXT_BLOCK_OPEN,
  CONTEXT_BLOCK_CLOSE,
  TRUNCATION_MARKER,
  unescapeContextDelimiters,
} from "./context";

/**
 * Parses a `<portal-context>` block (rendered by
 * ./context-resolve.ts#renderContextBlock) back out of a flat, stored user
 * message string — used by `./transcript.ts` to reconstruct chips for a
 * RESUMED thread (the live path never needs this: it already holds the
 * structured `MessageContext[]` it just built, before any serialization —
 * see spec 11 D19's discussion in the implementation plan).
 *
 * CLIENT-SAFE — zero node-only imports, matching ./context.ts and
 * ./events.ts's own discipline.
 *
 * Because every occurrence of a literal `<portal-context>`/`</portal-context>`
 * inside real vault content was escaped at render time (see
 * ./context.ts#escapeContextDelimiters), the FIRST unescaped close delimiter
 * found after the first open delimiter is unambiguously the real block
 * boundary — a hostile doc's forged delimiter text stays escaped, inert text.
 */

export interface ParsedContextChip {
  path: string;
  headingTrail: string[];
  startLine: number;
  endLine: number;
  provenance: "verified" | "relocated" | "client";
  truncated: boolean;
}

/**
 * What `ContextChip` (components/agent/context-chip.tsx) actually renders —
 * a superset of `ParsedContextChip` (every `ParsedContextChip` satisfies this
 * shape) that also covers the LIVE, pre-send chip: `agent-chat.tsx` builds
 * one directly from the `MessageContext` the user just attached, before any
 * server verification, so `provenance`/`truncated` aren't known yet there
 * (left undefined) and a `preview` of the raw selected text is shown instead
 * — a resumed/parsed chip has no raw excerpt text at all, only its
 * server-verified coordinates. This intentional asymmetry (pre-send chip:
 * what the user selected; post-send/resumed chip: what was actually
 * resolved) is spec 11's own design, not a bug.
 */
export interface DisplayContextChip {
  path: string;
  headingTrail: string[];
  startLine: number;
  endLine: number;
  provenance?: ParsedContextChip["provenance"];
  truncated?: boolean;
  preview?: string;
}

export interface ParsedContextBlock {
  chips: ParsedContextChip[];
  remainder: string;
}

const CHIP_HEADER_RE = /^\[\d+\] path: (.*)$/;
const HEADING_TRAIL_RE = /^ {4}heading trail: (.*)$/;
const LINES_RE = /^ {4}lines: (\d+)-(\d+)$/;
const PROVENANCE_RE = /^ {4}provenance: (.*)$/;
const EXCERPT_MARKER = "    excerpt:";
const SECTION_MARKER = "    enclosing section (bounded):";

/** Returns `null` when `text` contains no `<portal-context>` block at all — the common case. */
export function parseContextBlock(text: string): ParsedContextBlock | null {
  const openIdx = text.indexOf(CONTEXT_BLOCK_OPEN);
  if (openIdx === -1) return null;
  const closeIdx = text.indexOf(CONTEXT_BLOCK_CLOSE, openIdx + CONTEXT_BLOCK_OPEN.length);
  if (closeIdx === -1) return null;

  const inner = text.slice(openIdx + CONTEXT_BLOCK_OPEN.length, closeIdx);
  const remainder = text.slice(closeIdx + CONTEXT_BLOCK_CLOSE.length).replace(/^\n+/, "");

  const lines = inner.split("\n");
  const chips: ParsedContextChip[] = [];
  let i = 0;

  while (i < lines.length) {
    const header = CHIP_HEADER_RE.exec(lines[i]);
    if (!header) {
      i++;
      continue;
    }
    const path = unescapeContextDelimiters(header[1]);
    i++;

    let headingTrail: string[] = [];
    let startLine = 0;
    let endLine = 0;
    let provenance: ParsedContextChip["provenance"] = "verified";

    while (i < lines.length) {
      const ht = HEADING_TRAIL_RE.exec(lines[i]);
      if (ht) {
        const trail = unescapeContextDelimiters(ht[1]);
        headingTrail = trail === "(none)" ? [] : trail.split(" > ");
        i++;
        continue;
      }
      const ln = LINES_RE.exec(lines[i]);
      if (ln) {
        startLine = Number(ln[1]);
        endLine = Number(ln[2]);
        i++;
        continue;
      }
      const pr = PROVENANCE_RE.exec(lines[i]);
      if (pr) {
        provenance = pr[1].startsWith("client-supplied") ? "client" : (pr[1] as ParsedContextChip["provenance"]);
        i++;
        continue;
      }
      break;
    }

    let truncated = false;
    if (i < lines.length && lines[i] === EXCERPT_MARKER) {
      i++;
      const excerptLines: string[] = [];
      while (i < lines.length && lines[i] !== SECTION_MARKER) {
        excerptLines.push(lines[i]);
        i++;
      }
      if (unescapeContextDelimiters(excerptLines.join("\n")).includes(TRUNCATION_MARKER)) truncated = true;

      if (i < lines.length && lines[i] === SECTION_MARKER) {
        i++;
        const sectionLines: string[] = [];
        while (i < lines.length && !CHIP_HEADER_RE.test(lines[i])) {
          sectionLines.push(lines[i]);
          i++;
        }
        if (unescapeContextDelimiters(sectionLines.join("\n")).includes(TRUNCATION_MARKER)) truncated = true;
      }
    }

    chips.push({ path, headingTrail, startLine, endLine, provenance, truncated });
  }

  return { chips, remainder };
}
