import { z } from "zod";

/**
 * Shared shape for "selection → chat" context (spec 11): a contributor
 * selects a passage in the native vault view and attaches it to their next
 * chat message as a structured chip, instead of just asking about a page
 * title.
 *
 * CLIENT-SAFE — never import node-only code here (mirrors ./events.ts's own
 * banner): this module is imported by both server code (the route,
 * ./context-resolve, ./context-block) and client components (agent-chat,
 * the composer, the selection toolbar).
 *
 * `MessageContext` is a discriminated union with one member today
 * (`doc-selection`) so later phases (a whole-page `doc-page` context, a
 * `search-result` context, a staged-edit `diff` context) can extend the wire
 * shape without breaking it — see spec 11 D16.
 */

export const MAX_CHIPS = 5;
/** Per-chip cap on the raw selected text a client may send. */
export const MAX_SELECTION_BYTES = 8 * 1024;
/** Cap on the total rendered context block across every chip in one message. */
export const MAX_TOTAL_CONTEXT_BYTES = 24 * 1024;
/** Markdown only goes to h6 — a defensive cap, not a real limit in practice. */
export const MAX_HEADING_TRAIL_DEPTH = 6;

export const CONTEXT_BLOCK_OPEN = "<portal-context>";
export const CONTEXT_BLOCK_CLOSE = "</portal-context>";

export const TRUNCATION_MARKER = "[... truncated — agent: use kb_read for the full section]";

const DocSelectionContext = z.object({
  type: z.literal("doc-selection"),
  /** Vault-relative path, POSIX, as read off the rendered page — re-verified server-side, never trusted as-is. */
  path: z.string().min(1).max(1024),
  headingTrail: z.array(z.string().max(200)).max(MAX_HEADING_TRAIL_DEPTH),
  /** 1-based, inclusive. */
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  selectedText: z.string().min(1).max(MAX_SELECTION_BYTES),
  docTitle: z.string().max(300),
});

/**
 * A selection in a SHARED DOC (spec 2026-08-27): the doc lives in SQLite, not
 * the vault, so the reference is its id plus the quoted text, no path and no
 * line range. Resolved by `./context-resolve-shared-doc.ts`, and accepted by
 * the agent route only when the request's own `docId` matches.
 */
const SharedDocSelectionContext = z.object({
  type: z.literal("shared-doc-selection"),
  docId: z.string().uuid(),
  quote: z.string().min(1).max(MAX_SELECTION_BYTES),
  docTitle: z.string().max(300),
});

// Refined AFTER the discriminated union is built, not on the member schema
// itself — chaining .refine() on a union member before handing it to
// z.discriminatedUnion() risks losing the literal-discriminant shape the
// union needs to dispatch on `type`. And a superRefine, not a refine: the
// line-order rule only exists on the member that HAS lines, so it must
// dispatch on `type` rather than assume every member carries the fields.
export const MessageContextSchema = z
  .discriminatedUnion("type", [DocSelectionContext, SharedDocSelectionContext])
  .superRefine((v, refCtx) => {
    if (v.type === "doc-selection" && v.endLine < v.startLine) {
      refCtx.addIssue({ code: "custom", message: "endLine must be >= startLine" });
    }
  });
export type MessageContext = z.infer<typeof MessageContextSchema>;
export type SharedDocSelection = Extract<MessageContext, { type: "shared-doc-selection" }>;
export type DocSelection = Extract<MessageContext, { type: "doc-selection" }>;

/**
 * Neutralizes a literal occurrence of either delimiter inside vault-derived
 * text before it's interpolated into a rendered `<portal-context>` block —
 * otherwise a hostile doc could forge a fake block boundary (break out of
 * the "this is data" frame, or plant a fake chip in someone's transcript).
 * `unescapeContextBlock` in ./context-block.ts reverses this for parsing;
 * keep the two in lockstep.
 */
export function escapeContextDelimiters(text: string): string {
  return text.replaceAll("<portal-context>", "<\\portal-context>").replaceAll("</portal-context>", "<\\/portal-context>");
}

export function unescapeContextDelimiters(text: string): string {
  return text.replaceAll("<\\/portal-context>", "</portal-context>").replaceAll("<\\portal-context>", "<portal-context>");
}
