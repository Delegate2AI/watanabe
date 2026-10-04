import type { AgentEvent } from "./events";
import type { DisplayContextChip } from "./context-block";

/**
 * Client-side conversation model. The server session holds the real history (we
 * never resend it), so this is purely for rendering the transcript.
 */

export interface UserTurn {
  id: string;
  role: "user";
  content: string;
  /**
   * Selection chips attached to this turn (spec 11). The live path
   * (components/agent/agent-chat.tsx) builds this directly from the
   * `MessageContext[]` it already holds pre-send; the resumed path
   * (./transcript.ts) parses it back out of the stored `<portal-context>`
   * block via ./context-block.ts. Both render through the same
   * `ContextChip` component.
   */
  context?: DisplayContextChip[];
}

export interface TextSegment {
  kind: "text";
  text: string;
}
export interface ThinkingSegment {
  kind: "thinking";
  text: string;
}
export interface ToolSegment {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  status: "running" | "ok" | "error";
  result?: unknown;
}
export type Segment = TextSegment | ThinkingSegment | ToolSegment;

export interface AssistantTurn {
  id: string;
  role: "assistant";
  segments: Segment[];
  status: "streaming" | "done" | "error";
  error?: string;
  costUsd?: number;
}

/** A divider in the transcript marking where the conversation was compacted. */
export interface CompactionTurn {
  id: string;
  role: "compaction";
  trigger: "manual" | "auto";
  preTokens: number;
  postTokens?: number;
}

export type Turn = UserTurn | AssistantTurn | CompactionTurn;

/** Fold one stream event into an assistant turn, returning a NEW turn (no mutation). */
export function applyEvent(turn: AssistantTurn, event: AgentEvent): AssistantTurn {
  switch (event.type) {
    case "text_delta":
      return appendText(turn, "text", event.delta);
    case "thinking_delta":
      return appendText(turn, "thinking", event.delta);
    case "tool_use":
      return {
        ...turn,
        segments: [
          ...turn.segments,
          { kind: "tool", id: event.id, name: event.name, input: event.input, status: "running" },
        ],
      };
    case "tool_result":
      return {
        ...turn,
        segments: turn.segments.map((s) =>
          s.kind === "tool" && s.id === event.id
            ? { ...s, status: event.isError ? "error" : "ok", result: event.content }
            : s,
        ),
      };
    case "turn_result":
      return {
        ...turn,
        status: event.ok ? "done" : "error",
        error: event.ok ? undefined : event.error,
        costUsd: event.costUsd,
      };
    case "error":
      return { ...turn, status: "error", error: event.message };
    default:
      return turn;
  }
}

function appendText(
  turn: AssistantTurn,
  kind: "text" | "thinking",
  delta: string,
): AssistantTurn {
  const last = turn.segments[turn.segments.length - 1];
  if (last && last.kind === kind) {
    const updated = { ...last, text: last.text + delta };
    return { ...turn, segments: [...turn.segments.slice(0, -1), updated] };
  }
  return { ...turn, segments: [...turn.segments, { kind, text: delta }] };
}
