import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { getVersions, latestBody } from "@/lib/db/shared-docs";
import { createSuggestion } from "@/lib/db/suggestions";
import { createAnchor, locateInSource, type TextAnchor } from "./anchor";

/**
 * The one place a suggestion row is proposed (spec 2026-07-22 via the route,
 * spec 2026-08-27 via the copilot tool). Never trusts a claimed anchor
 * position: the quote is re-located in the CURRENT markdown source, and a
 * quote that is not a single contiguous match is refused with its occurrence
 * count, so the caller can say "appears N times" instead of storing a
 * proposal Accept could never safely apply. Authorization is the caller's
 * job; both callers require `canComment` before reaching here.
 */
export type ProposeOutcome =
  | { ok: true; suggestionId: string; baseVersion: number }
  | { ok: false; reason: "anchor"; matches: number };

function countOccurrences(source: string, quote: string): number {
  if (quote === "") return 0;
  let n = 0;
  for (let i = source.indexOf(quote); i !== -1; i = source.indexOf(quote, i + 1)) n++;
  return n;
}

/** Propose from a full anchor (the annotation layer's path). */
export function proposeSuggestion(
  db: DatabaseType,
  input: {
    docId: string;
    anchor: TextAnchor;
    proposedText: string;
    note: string | null;
    createdBy: string;
    via: string | null;
  },
): ProposeOutcome {
  const currentBody = latestBody(db, input.docId) ?? "";
  const range = locateInSource(currentBody, input.anchor);
  if (!range || currentBody.slice(range.start, range.end) !== input.anchor.quote) {
    return { ok: false, reason: "anchor", matches: countOccurrences(currentBody, input.anchor.quote) };
  }
  const versions = getVersions(db, input.docId);
  const baseVersion = versions.length > 0 ? versions[versions.length - 1].version : 1;
  const suggestionId = randomUUID();
  createSuggestion(db, {
    id: suggestionId,
    docId: input.docId,
    baseVersion,
    anchor: input.anchor,
    // originalText is never taken from the caller: it always equals the
    // server-resolved anchor quote, so the review card can never describe a
    // different target than what Accept will locate and splice.
    originalText: input.anchor.quote,
    proposedText: input.proposedText,
    note: input.note,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    via: input.via,
  });
  return { ok: true, suggestionId, baseVersion };
}

/**
 * Propose from a bare quote (the copilot tool's path): the anchor is computed
 * here, never by the model. Exactly one occurrence in the source is required;
 * zero or many refuses with the count.
 */
export function proposeSuggestionFromQuote(
  db: DatabaseType,
  input: {
    docId: string;
    quote: string;
    proposedText: string;
    note: string | null;
    createdBy: string;
    via: string | null;
  },
): ProposeOutcome {
  const currentBody = latestBody(db, input.docId) ?? "";
  const matches = countOccurrences(currentBody, input.quote);
  if (matches !== 1) return { ok: false, reason: "anchor", matches };
  const start = currentBody.indexOf(input.quote);
  const anchor = createAnchor(currentBody, start, start + input.quote.length);
  return proposeSuggestion(db, {
    docId: input.docId,
    anchor,
    proposedText: input.proposedText,
    note: input.note,
    createdBy: input.createdBy,
    via: input.via,
  });
}
