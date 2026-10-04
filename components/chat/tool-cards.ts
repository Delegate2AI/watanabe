import type { AssistantTurn, ToolSegment } from "@/lib/agent/conversation";

/** A KB citation derived from a `kb_read`/`kb_search` tool call on a turn. */
export interface SourceRef {
  path: string;
  /** The doc's visibility label when the tool result reported one, else undefined. */
  visibility?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Pull the citation path out of a `kb_read` tool call's input.
 *
 * `kb_read` ONLY. It is the one KB tool whose `path` names a document the
 * answer was actually grounded in. `kb_search` used to qualify too, which put
 * two things on screen that were never documents: its `query` (the search words
 * themselves, rendered as a citation, so asking about "Phase 4" produced a card
 * labelled "Phase 4" that opened to "this document is not available"), and its
 * optional `path`, which scopes WHERE to search and is a directory. A search is
 * how the answer found its sources, not one of them; whatever it turned up gets
 * cited by the `kb_read` that followed.
 */
function sourceFrom(seg: ToolSegment): SourceRef | null {
  if (seg.name.replace(/^mcp__kb__/, "") !== "kb_read") return null;
  const path = str(((seg.input ?? {}) as Record<string, unknown>).path);
  if (!path) return null;
  const result = (seg.result ?? {}) as Record<string, unknown>;
  return { path, visibility: str(result.visibility) };
}

/**
 * Map an assistant turn's tool segments to the `SourceCard` citations the chat
 * UI renders beneath the turn (spec 24). Only the read-only KB tools surface as
 * citations; duplicates (same path read twice in one turn) collapse to one.
 */
export function sourceRefs(turn: AssistantTurn): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const seg of turn.segments) {
    if (seg.kind !== "tool") continue;
    const ref = sourceFrom(seg);
    if (ref && !seen.has(ref.path)) {
      seen.add(ref.path);
      out.push(ref);
    }
  }
  return out;
}
