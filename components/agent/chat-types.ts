import type { MessageContext } from "@/lib/agent/context";
import type { DisplayContextChip } from "@/lib/agent/context-block";

/** The live, pre-send chip a user just attached — server hasn't verified it yet, so provenance/truncated are unknown (see DisplayContextChip's own doc comment). */
export function toDisplayChip(ctx: MessageContext): DisplayContextChip {
  if (ctx.type === "shared-doc-selection") {
    // Spec 2026-08-27: a shared-doc quote has no path or line range; render it
    // by its stable shared-doc identity, matching the server's own rendering.
    return { path: `shared-doc:${ctx.docId}`, headingTrail: [], startLine: 1, endLine: 1, preview: ctx.quote };
  }
  return {
    path: ctx.path,
    headingTrail: ctx.headingTrail,
    startLine: ctx.startLine,
    endLine: ctx.endLine,
    preview: ctx.selectedText,
  };
}

/** A past chat, scoped server-side to the current owner (mirrors lib/db/threads#ThreadRecord). */
export interface AgentSessionInfo {
  id: string;
  title: string;
  updatedAt: string;
}

/** The signed-in identity, resolved server-side (see app/page.tsx, lib/auth/identity.ts). */
export interface AgentChatIdentity {
  email: string;
  name?: string;
}

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export const STORAGE_KEY = "watanabe-agent-session-id";
export const NEAR_BOTTOM_PX = 80;

/**
 * Tool results that mean "the session's staged draft may have just changed"
 * (spec 12 D26) — a successful result from any of these is what triggers a
 * live `refreshDraftState()` call, independent of the page's own
 * server-rendered draft data (see `page.tsx`'s `resolveDraftView` /
 * `DraftBanner`'s `activeDraft` prop).
 */
export const DRAFT_MUTATING_TOOLS = new Set([
  "mcp__kb__kb_stage_edit",
  "mcp__kb__kb_stage_delete",
  "mcp__kb__kb_discard",
  "mcp__kb__kb_submit",
]);
