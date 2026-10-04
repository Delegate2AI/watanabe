import type { Database as DatabaseType } from "better-sqlite3";
import { getSharedDoc, getVersions, latestVersionOf } from "@/lib/db/shared-docs";
import { listThreads } from "@/lib/db/comment-threads";
import { listSuggestions } from "@/lib/db/suggestions";
import { accessFor, canComment, type EffectiveAccess } from "@/lib/shared-docs/access";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { proposeSuggestionFromQuote } from "@/lib/shared-docs/propose-suggestion";

/**
 * The doc copilot's tool logic (spec 2026-08-27), kept as plain functions so
 * they are unit-testable against `openDb(":memory:")` without the SDK;
 * `lib/copilot-mcp/server.ts` wraps them.
 *
 * The binding IS the closure: `docId` comes from `CopilotToolContext`, never
 * from tool input, so a prompt-injected id has nowhere to land (the `docWrite`
 * ownership doctrine, one level up). Every call re-resolves the caller's ACL
 * so a share revoked mid-session fails closed on the next call, and every
 * outcome is a value, never a throw across the tool boundary.
 */
export interface CopilotToolContext {
  db: DatabaseType;
  docId: string;
  ownerEmail: string;
}

export type ToolOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/** The same sentence for a missing doc and a revoked share: no existence oracle. */
const GONE = "This document is not available to you any more.";

function authorize(ctx: CopilotToolContext): { doc: NonNullable<ReturnType<typeof getSharedDoc>>; access: EffectiveAccess } | null {
  const doc = getSharedDoc(ctx.db, ctx.docId);
  if (!doc) return null;
  const access = accessFor(ctx.db, ctx.docId, ctx.ownerEmail, shareClearanceFor(ctx.ownerEmail));
  if (!canComment(access)) return null;
  return { doc, access };
}

/** The latest document state: always re-read, so a human edit mid-conversation is visible. */
export function copilotRead(ctx: CopilotToolContext): ToolOutcome<{
  title: string;
  body: string;
  version: number;
  format: string;
  yourAccess: EffectiveAccess;
}> {
  const authorized = authorize(ctx);
  if (!authorized) return { ok: false, error: GONE };
  const latest = latestVersionOf(ctx.db, ctx.docId);
  const versions = getVersions(ctx.db, ctx.docId);
  return {
    ok: true,
    result: {
      title: authorized.doc.title,
      body: latest?.body ?? "",
      version: versions.length > 0 ? versions[versions.length - 1].version : 1,
      format: latest?.format ?? "md",
      yourAccess: authorized.access,
    },
  };
}

/** Open comment threads and pending suggestions: the ground truth for "address the feedback". */
export function copilotReviewState(ctx: CopilotToolContext): ToolOutcome<{
  openThreads: Array<{ id: string; anchorQuote: string | null; messages: Array<{ author: string; body: string }> }>;
  pendingSuggestions: Array<{ id: string; originalText: string; proposedText: string; note: string | null; via: string | null }>;
}> {
  const authorized = authorize(ctx);
  if (!authorized) return { ok: false, error: GONE };
  const openThreads = listThreads(ctx.db, ctx.docId)
    .filter((t) => t.status === "open")
    .map((t) => ({
      id: t.id,
      anchorQuote: t.anchor?.quote ?? null,
      messages: t.messages.map((m) => ({ author: m.authorEmail, body: m.body })),
    }));
  const pendingSuggestions = listSuggestions(ctx.db, ctx.docId)
    .filter((s) => s.status === "pending")
    .map((s) => ({ id: s.id, originalText: s.originalText, proposedText: s.proposedText, note: s.note, via: s.via }));
  return { ok: true, result: { openThreads, pendingSuggestions } };
}

/**
 * File a suggestion, attributed to the acting user with `via = 'copilot'`.
 * The quote must occur exactly once in the current markdown source; the
 * refusal names the count so the model can extend the quote and retry.
 */
export function copilotSuggest(
  ctx: CopilotToolContext,
  input: { quote: string; proposedText: string; note?: string },
): ToolOutcome<{ suggestionId: string; baseVersion: number }> {
  const authorized = authorize(ctx);
  if (!authorized) return { ok: false, error: GONE };
  if (typeof input.quote !== "string" || input.quote.trim() === "") {
    return { ok: false, error: "copilot_suggest requires a non-empty quote from the document." };
  }
  const outcome = proposeSuggestionFromQuote(ctx.db, {
    docId: ctx.docId,
    quote: input.quote,
    proposedText: input.proposedText,
    note: input.note?.trim() ? input.note.trim() : null,
    createdBy: ctx.ownerEmail,
    via: "copilot",
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error:
        outcome.matches === 0
          ? "The quote does not appear in the current document. Re-read it with copilot_read and quote the text exactly."
          : `The quote appears ${outcome.matches} times in the document. Extend it until it is unique, then try again.`,
    };
  }
  return { ok: true, result: { suggestionId: outcome.suggestionId, baseVersion: outcome.baseVersion } };
}
