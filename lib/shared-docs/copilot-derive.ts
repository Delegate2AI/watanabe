import type { AssistantTurn, Turn } from "@/lib/agent/conversation";

/**
 * Client-safe derivation of copilot suggestions from the transcript (spec
 * 2026-08-27), the `lib/canvas/derive.ts` pattern: read the
 * `mcp__copilot__copilot_suggest` tool segments the conversation reducer
 * already built and pull out what the tool returned, so the panel can render
 * a card and nudge the margin refresh without a second wire contract.
 *
 * Type-only imports keep this module free of any server value, so it is safe
 * to pull into a "use client" component.
 */

/** The tool name the copilot MCP server registers (see lib/copilot-mcp/server.ts). */
export const COPILOT_SUGGEST_TOOL = "mcp__copilot__copilot_suggest";

export interface CopilotSuggestionRef {
  suggestionId: string;
  baseVersion: number;
}

function isSuggestionRef(value: unknown): value is CopilotSuggestionRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.suggestionId === "string" && typeof v.baseVersion === "number";
}

/**
 * Extract a `{ suggestionId, baseVersion }` from a `copilot_suggest` tool
 * result. The MCP result is a content array `[{ type: "text", text: "<json>" }]`;
 * a bare JSON string is also accepted. Returns null for anything else,
 * including the tool's own plain-text refusals.
 */
export function parseCopilotSuggestResult(result: unknown): CopilotSuggestionRef | null {
  let text: string | null = null;
  if (typeof result === "string") {
    text = result;
  } else if (Array.isArray(result)) {
    const block = result.find(
      (b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    );
    text = block?.text ?? null;
  }
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return isSuggestionRef(parsed) ? { suggestionId: parsed.suggestionId, baseVersion: parsed.baseVersion } : null;
  } catch {
    return null;
  }
}

/** The successful `copilot_suggest` results in a single assistant turn, in order. */
export function suggestionsInTurn(turn: AssistantTurn): CopilotSuggestionRef[] {
  const out: CopilotSuggestionRef[] = [];
  for (const seg of turn.segments) {
    if (seg.kind !== "tool" || seg.name !== COPILOT_SUGGEST_TOOL || seg.status !== "ok") continue;
    const ref = parseCopilotSuggestResult(seg.result);
    if (ref) out.push(ref);
  }
  return out;
}

/** Total filed suggestions across the transcript: the panel's margin-refresh signal. */
export function suggestionCount(turns: Turn[]): number {
  let n = 0;
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    n += suggestionsInTurn(turn).length;
  }
  return n;
}
