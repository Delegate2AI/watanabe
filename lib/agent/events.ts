/**
 * Wire protocol between the KB chat agent backend and the chat UI.
 *
 * CLIENT-SAFE — never import node-only code here, so both the server
 * (session/normalize) and the browser (conversation reducer) share one source
 * of truth for the event shape. Events stream as NDJSON.
 *
 * The `permission_*` variants carry the PreToolUse gate's "confirm" tier
 * (./permissions) — today, `kb_submit` (when write mode is on) and most
 * non-allowlisted Bash calls (./bash-policy) route through them.
 *
 * `AdvisoryFinding` is imported type-only (spec 14, subsystem B3/B4): its
 * home module (`lib/quality/agents.ts`) pulls in the Agent SDK, which is not
 * client-safe, so only the TYPE crosses into this shared wire-protocol file.
 */
import type { AdvisoryFinding } from "@/lib/quality/agents";

/** A decision an operator can make on a pending tool confirmation. */
export type PermissionDecision = "allow" | "allow_always" | "deny";

/** One framed event on the agent stream. */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; text: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; content: unknown; isError: boolean }
  | {
      /** The agent wants to run a gated tool; the operator must confirm. */
      type: "permission_request";
      requestId: string;
      toolName: string;
      input: unknown;
      /**
       * Advisory quality findings for a `kb_submit` confirm (spec 12,
       * subsystems B3/B4), gathered via `lib/quality/gather.ts`. Undefined or
       * `[]` for every other gated tool, and for `kb_submit` itself whenever
       * quality gates are disabled; the confirm modal (Task 14) treats both
       * as "no findings".
       */
      advisoryFindings?: AdvisoryFinding[];
    }
  | { type: "permission_resolved"; requestId: string; decision: PermissionDecision }
  | {
      /** The conversation was summarized to free context (manual or auto). */
      type: "compacted";
      trigger: "manual" | "auto";
      preTokens: number;
      postTokens?: number;
    }
  | {
      type: "turn_result";
      ok: boolean;
      /** Cost of this single turn, in USD. */
      costUsd: number;
      /** Running total for the whole session, in USD. */
      sessionCostUsd: number;
      durationMs: number;
      result?: string;
      error?: string;
    }
  | { type: "error"; message: string };

/**
 * A point-in-time snapshot of how full the session's context window is.
 * Returned by `GET /api/agent/context` (null when the session isn't warm).
 */
export interface ContextUsage {
  totalTokens: number;
  maxTokens: number;
  /** 0–100, as reported by the SDK. */
  percentage: number;
}
