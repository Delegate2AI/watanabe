import { isContentConfigured } from "@/lib/content/config";

export const MCP_CONTENT_TOOL_PREFIX = "mcp__content__";

const CONTENT_TOOLS: ReadonlySet<string> = new Set([
  "mcp__content__content_formats",
  "mcp__content__content_request",
  "mcp__content__content_status",
]);

export function gateContentTool(toolName: string): "allow" | "deny" {
  return isContentConfigured() && CONTENT_TOOLS.has(toolName) ? "allow" : "deny";
}
