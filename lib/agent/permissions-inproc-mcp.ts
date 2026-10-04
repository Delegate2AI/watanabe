import { gateCopilotTool, MCP_COPILOT_TOOL_PREFIX } from "./permissions-copilot";
import { gateContentTool, MCP_CONTENT_TOOL_PREFIX } from "./permissions-content";

/**
 * One dispatch for the in-process MCP servers whose slugs are reserved
 * (`RESERVED_CONNECTOR_SLUGS` in `lib/connectors/types.ts`) but whose gating
 * does not live in `permission-constants.ts` alongside `doc`, `mem` and `tasks`.
 *
 * Why a dispatcher rather than one branch each in `lib/agent/permissions.ts`:
 * that file sits exactly at the repo's file-size block, so every server added
 * this way would cost the core gate a line it does not have, and the third one
 * would refuse every future edit to the gate itself. Adding a server here costs
 * `permissions.ts` nothing.
 *
 * Returning `null` for an unrecognised name matters: it means "not mine", which
 * is what lets the caller fall through to the external-connector path. A `deny`
 * here would swallow every third-party `mcp__` tool.
 */
export function gateInProcessMcpTool(toolName: string): "allow" | "deny" | null {
  if (toolName.startsWith(MCP_COPILOT_TOOL_PREFIX)) return gateCopilotTool(toolName);
  if (toolName.startsWith(MCP_CONTENT_TOOL_PREFIX)) return gateContentTool(toolName);
  return null;
}
