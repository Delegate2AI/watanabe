import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { kbList, kbRead, kbSearch } from "./tools";
import { subjectPrefix } from "@/lib/config/subject";

/**
 * The three read-only vault tools (kb_list/kb_read/kb_search), factored out
 * of lib/kb-mcp/server.ts so they can be reused by a standalone,
 * write-tool-free MCP server (createKbReadOnlyMcpServer) for the
 * integrity-checker quality-gate agent, without importing anything from
 * server.ts: that would pull in its createWriteTools import, which is
 * exactly the write-tool exposure this read-only server must never have.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the SDK's own `createSdkMcpServer({ tools: Array<SdkMcpToolDefinition<any>> })` signature.
export function kbReadOnlyTools(scopeRoot?: string): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      "kb_list",
      "List files and subdirectories under a path in the knowledge-base vault. " +
        "Non-recursive by default. Use this to orient yourself before reading a file.",
      {
        path: z
          .string()
          .optional()
          .describe('Path relative to the vault root, e.g. "02-market-and-research". Defaults to the vault root (".").'),
        recursive: z
          .boolean()
          .optional()
          .describe("List the full subtree instead of just the immediate children. Defaults to false."),
      },
      async (args) => kbList(args, scopeRoot),
    ),
    tool(
      "kb_read",
      "Read the full contents of one file in the knowledge-base vault by its path " +
        "relative to the vault root. Text files only (e.g. .md); rejects binary or " +
        "oversized (>1MB) files with a clear error instead of the raw bytes.",
      {
        path: z.string().describe('File path relative to the vault root, e.g. "04-economy/tokenomics.md".'),
      },
      async (args) => kbRead(args, scopeRoot),
    ),
    tool(
      "kb_search",
      "Search the knowledge-base vault for a text query (case-insensitive substring " +
        "match) and return matching file paths with the matching line snippets. " +
        "Optionally scope the search to a subdirectory. Capped at 50 matches.",
      {
        query: z.string().describe("Text to search for."),
        path: z
          .string()
          .optional()
          .describe('Restrict the search to this vault-relative path. Defaults to the whole vault (".").'),
      },
      async (args) => kbSearch(args, scopeRoot),
    ),
  ];
}

/**
 * A minimal MCP server exposing ONLY the three read-only tools above: no
 * write tools, no index tool. Used by lib/quality/agents.ts's
 * integrity-checker so the model literally cannot see a write tool, not
 * merely be denied one via allowedTools.
 */
export function createKbReadOnlyMcpServer(scopeRoot?: string) {
  return createSdkMcpServer({
    name: "kb",
    version: "1.0.0",
    instructions:
      `Access to the ${subjectPrefix()}knowledge-base vault. Use kb_list to orient yourself, ` +
      "kb_search to find relevant files by keyword, and kb_read to read a specific file's " +
      "full contents. All paths are relative to the vault root.",
    alwaysLoad: true,
    tools: kbReadOnlyTools(scopeRoot),
  });
}
