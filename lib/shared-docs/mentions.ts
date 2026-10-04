/**
 * @mention parsing for doc comments (spec 2026-07-22). A mention is `@` directly
 * followed by an email. Purely textual: no notification is dispatched in v1.
 */
const MENTION = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Unique known emails referenced by `@email` in `body`. */
export function extractMentions(body: string, known: string[]): string[] {
  const set = new Set(known);
  const out: string[] = [];
  for (const m of body.matchAll(MENTION)) {
    if (set.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Split `body` into alternating plain-text and mention runs for chip rendering. */
export function mentionSegments(body: string): Array<{ text: string; mention: boolean }> {
  const segs: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ text: body.slice(last, idx), mention: false });
    segs.push({ text: m[0], mention: true });
    last = idx + m[0].length;
  }
  if (last < body.length) segs.push({ text: body.slice(last), mention: false });
  return segs;
}
