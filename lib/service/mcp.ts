import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { messageFor } from "@/lib/errors/messages";
import type { ServiceResult } from "./result";

/**
 * The MCP half of the adapter pair: a `ServiceResult` in, a `CallToolResult` out.
 *
 * A failure renders as the sentence `lib/errors/messages.ts` already holds for
 * that code. The code itself never reaches the text. That module exists because
 * internal strings shipped as user-facing copy once already, one of them an
 * environment variable name, and an agent reading a tool result back to a person
 * is exactly the same disclosure path as a rendered error banner. `message` is
 * for logs and never rendered, for the same reason.
 *
 * The result shape is built here rather than imported from
 * `lib/kb-mcp/paths.ts`'s `textResult`/`errorResult`. Those are two lines each,
 * and reaching into a knowledge-base module from the generic service layer would
 * point the dependency the wrong way for the sake of not retyping them.
 */
export function toolResult<T>(result: ServiceResult<T>): CallToolResult {
  if (result.ok) {
    return { content: [{ type: "text", text: JSON.stringify(result.value) }] };
  }
  const sentence = messageFor(result.code);
  const text = result.detail === undefined ? sentence : `${sentence} (${result.detail})`;
  return { content: [{ type: "text", text }], isError: true };
}
