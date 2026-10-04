import type { TextAnchor } from "./types";

export type { TextAnchor };

const CONTEXT = 32;

/** Build a quote+context anchor for `[start, end)` in `text`. Pure, never throws. */
export function createAnchor(text: string, start: number, end: number): TextAnchor {
  const s = clamp(start, 0, text.length);
  const e = clamp(end, s, text.length);
  return {
    quote: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, Math.min(text.length, e + CONTEXT)),
    start: s,
  };
}

/**
 * Relocate an anchor in `text`. Returns the best `{start,end}` or `null` when the
 * quote no longer occurs. Selection is strictly lexicographic: the candidate
 * with the highest context-match score always wins, no matter how far it sits
 * from the recorded `start`; only candidates tied on context are broken by
 * proximity. (A weighted score like `ctx * 1000 + proximity` looks like it
 * makes context dominate, but a document large enough for `proximity` to
 * exceed that constant lets a nearer, context-free hit outrank a correct match
 * far away -- lexicographic comparison has no such ceiling.) Never throws.
 */
export function resolveAnchor(text: string, a: TextAnchor): { start: number; end: number } | null {
  if (a.quote === "") return null;
  const hits: number[] = [];
  for (let i = text.indexOf(a.quote); i !== -1; i = text.indexOf(a.quote, i + 1)) hits.push(i);
  if (hits.length === 0) return null;

  let best = hits[0];
  let bestCtx = -Infinity;
  let bestDist = Infinity;
  for (const i of hits) {
    const before = text.slice(Math.max(0, i - a.prefix.length), i);
    const after = text.slice(i + a.quote.length, i + a.quote.length + a.suffix.length);
    const ctx = commonSuffixLen(before, a.prefix) + commonPrefixLen(after, a.suffix);
    const dist = Math.abs(i - a.start);
    if (ctx > bestCtx || (ctx === bestCtx && dist < bestDist)) {
      bestCtx = ctx;
      bestDist = dist;
      best = i;
    }
  }
  return { start: best, end: best + a.quote.length };
}

/**
 * Locate an anchor's quote in the Markdown SOURCE for applying a suggestion.
 * Fail-safe: returns a range ONLY when there is a single best match. If the
 * quote is absent, or two occurrences tie on context score, returns null so the
 * caller marks the suggestion stale rather than splicing the wrong span.
 */
export function locateInSource(source: string, a: TextAnchor): { start: number; end: number } | null {
  if (a.quote === "") return null;
  const hits: number[] = [];
  for (let i = source.indexOf(a.quote); i !== -1; i = source.indexOf(a.quote, i + 1)) hits.push(i);
  if (hits.length === 0) return null;
  if (hits.length === 1) return { start: hits[0], end: hits[0] + a.quote.length };

  let best = -1;
  let bestScore = -Infinity;
  let tie = false;
  for (const i of hits) {
    const before = source.slice(Math.max(0, i - a.prefix.length), i);
    const after = source.slice(i + a.quote.length, i + a.quote.length + a.suffix.length);
    const score = commonSuffixLen(before, a.prefix) + commonPrefixLen(after, a.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = i;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }
  if (tie || best < 0) return null;
  return { start: best, end: best + a.quote.length };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
