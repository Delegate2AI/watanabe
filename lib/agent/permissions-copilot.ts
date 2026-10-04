import { isDocCopilotEnabled } from "@/lib/shared-docs/config";

/**
 * The gate branch for the doc copilot's MCP server (spec 2026-08-27). Like
 * the `doc` branch, this is the backstop to registration being the primary
 * control: the `copilot` server is only built for a doc-bound session with
 * the flag on (`lib/agent/config.ts`), so an allowed name here still cannot
 * reach a tool that was never registered.
 *
 * `copilot_suggest` is "allow", not "confirm": a suggestion is itself the
 * confirmation surface (a pending row a human accepts or rejects in the
 * margin), so a permission modal in front of it would be two review queues
 * for one change.
 */
export const MCP_COPILOT_TOOL_PREFIX = "mcp__copilot__";

const COPILOT_TOOLS: ReadonlySet<string> = new Set([
  "mcp__copilot__copilot_read",
  "mcp__copilot__copilot_review_state",
  "mcp__copilot__copilot_suggest",
]);

export function gateCopilotTool(toolName: string): "allow" | "deny" {
  return isDocCopilotEnabled() && COPILOT_TOOLS.has(toolName) ? "allow" : "deny";
}
