import type { HookJSONOutput, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * The session's SDK plumbing primitives, split out of `./session.ts`
 * (file-size split; behavior unchanged): the three PreToolUse hook outputs and
 * the pushable input queue that feeds `query()` in streaming-input mode.
 */

export function allowOutput(): HookJSONOutput {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
}

export function denyOutput(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * A `"confirm"` gate verdict (currently only `kb_submit`, see ./permissions)
 * surfaces to the SDK as `permissionDecision: "ask"` — per
 * `@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts`, this is what routes the call
 * to the `canUseTool` control-request mechanism (`Options.canUseTool`) rather
 * than deciding it inline in the hook. See `PermissionBroker` for what
 * happens next.
 */
export function askOutput(): HookJSONOutput {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" } };
}

/** A pushable async-iterable of user messages — the live input to `query()`. */
export function createInputQueue() {
  const buffer: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const iterable: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };

  return {
    iterable,
    push(message: SDKUserMessage) {
      buffer.push(message);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
  };
}
