import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "./events";

/**
 * Convert one raw SDK message into zero or more UI events.
 *
 * Text and thinking stream via `stream_event` deltas (we enable
 * `includePartialMessages`), so the full `assistant` message contributes only
 * its `tool_use` blocks — emitting its text again would duplicate the stream.
 * `result` is handled by the session (it owns the running cost), not here.
 */
export function normalizeMessage(msg: SDKMessage): AgentEvent[] {
  switch (msg.type) {
    case "stream_event":
      return fromStreamEvent(msg.event);
    case "assistant":
      return fromAssistant(msg.message);
    case "user":
      return fromToolResults(msg.message);
    case "system":
      return fromSystem(msg);
    default:
      return [];
  }
}

/**
 * The only system message we surface is the compaction boundary — it lets the
 * chat draw a "context compacted N→M tokens" divider. Everything else is ignored.
 */
function fromSystem(msg: unknown): AgentEvent[] {
  const m = msg as {
    subtype?: string;
    compact_metadata?: { trigger?: "manual" | "auto"; pre_tokens?: number; post_tokens?: number };
  };
  if (m.subtype !== "compact_boundary" || !m.compact_metadata) return [];
  return [
    {
      type: "compacted",
      trigger: m.compact_metadata.trigger ?? "manual",
      preTokens: m.compact_metadata.pre_tokens ?? 0,
      postTokens: m.compact_metadata.post_tokens,
    },
  ];
}

function fromStreamEvent(event: unknown): AgentEvent[] {
  const e = event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
  if (e?.type !== "content_block_delta" || !e.delta) return [];
  if (e.delta.type === "text_delta" && typeof e.delta.text === "string") {
    return [{ type: "text_delta", delta: e.delta.text }];
  }
  if (e.delta.type === "thinking_delta" && typeof e.delta.thinking === "string") {
    return [{ type: "thinking_delta", delta: e.delta.thinking }];
  }
  return [];
}

function fromAssistant(message: unknown): AgentEvent[] {
  const blocks = (message as { content?: unknown[] })?.content ?? [];
  const out: AgentEvent[] = [];
  for (const raw of blocks) {
    const block = raw as { type?: string; id?: string; name?: string; input?: unknown };
    if (block.type === "tool_use") {
      out.push({
        type: "tool_use",
        id: block.id ?? "",
        name: block.name ?? "tool",
        input: block.input ?? {},
      });
    }
  }
  return out;
}

function fromToolResults(message: unknown): AgentEvent[] {
  const blocks = (message as { content?: unknown[] })?.content;
  if (!Array.isArray(blocks)) return [];
  const out: AgentEvent[] = [];
  for (const raw of blocks) {
    const block = raw as {
      type?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (block.type === "tool_result") {
      out.push({
        type: "tool_result",
        id: block.tool_use_id ?? "",
        content: block.content,
        isError: block.is_error === true,
      });
    }
  }
  return out;
}
