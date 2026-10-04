import type { ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Capability } from "@/lib/authority/roles";
import type { ServiceContext } from "./actor";

/**
 * One MCP tool, described as data rather than as a `registerTool` call.
 *
 * A domain exports an array of these and never imports the MCP server, which is
 * what keeps `app/api/mcp/server.ts` from growing a section per domain as the
 * surface widens. The registration loop lives in `app/api/mcp/register.ts` and
 * is the only place that knows about `McpServer`.
 *
 * `inputSchema` is the raw shape the service already exports, passed through by
 * reference rather than restated. That is the whole point of D4: a tool and a
 * route that describe the same operation with two schemas drift on the first
 * field anybody adds, and the drift is silent until a caller hits the half that
 * was not updated.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint: false;
  };
  /**
   * What registration filters on. `null` means every known member sees this
   * tool, which is the answer whenever the matching REST route checks clearance
   * or ownership rather than a role: gating the tool on a capability the route
   * does not require would invent an authorization rule.
   *
   * It is never the real check. The service re-checks whatever a tool claims,
   * per call, so a role revoked while a session is open is honored rather than
   * frozen into the tool list the client is holding.
   */
  capability: Capability | null;
  handler: (ctx: ServiceContext, args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
}
