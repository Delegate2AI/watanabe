import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { isKbWriteEnabled } from "@/lib/agent/permissions";
import { stagedIndexMarkdown } from "@/lib/index/cache";
import { buildIndex } from "@/lib/index/build";
import { renderIndexMarkdown } from "@/lib/index/cache";
import { isIndexEnabled } from "@/lib/index/config";
import { kbReadOnlyTools } from "./read-tools";
import { createWriteTools, type KbWriteContext } from "./write-tools";
import { subjectPrefix } from "@/lib/config/subject";

/**
 * Build the in-process vault MCP server, wired into the chat agent via
 * `Options.mcpServers` (see `lib/agent/config.ts`). `createSdkMcpServer`
 * (from `@anthropic-ai/claude-agent-sdk`) runs the whole server in this same
 * Node process — no subprocess, no network hop — and the SDK exposes each of
 * its tools to the model as `mcp__kb__<toolName>` (server name `"kb"`, set
 * below), which is exactly the prefix `lib/agent/permissions.ts`'s
 * `isAgentToolAllowed` allow-lists.
 *
 * The three read tools (`kb_list`/`kb_read`/`kb_search`) are ALWAYS
 * registered — they're read-only and share their implementation with the
 * HTTP surface at `app/api/mcp/route.ts` via `./tools`. The five write/
 * staging tools (`kb_stage_edit`/`kb_stage_delete`/`kb_diff`/`kb_discard`/
 * `kb_submit`, `./write-tools`) are registered ONLY when `isKbWriteEnabled()`
 * — this is the PRIMARY control on write capability (the model can't even
 * see a tool that was never registered); `lib/agent/permissions.ts`'s own
 * flag re-check in `gateAgentTool` is the belt-and-suspenders backstop if
 * registration and the gate ever drift apart. `kb_index` (renders the
 * generated vault map from `@/lib/index/cache`) is registered ONLY when
 * `isIndexEnabled()` (`@/lib/index/config`); it needs no matching gate
 * change since it already falls under the `mcp__kb__` prefix the gate
 * allow-lists (see `lib/agent/permissions.ts`).
 *
 * A fresh server instance is built per `AgentSession` (not a module-level
 * singleton) because the write tools need `context` (`KbWriteContext`, see
 * `./write-tools`) bound to that specific session's thread/owner identity.
 */
export function createKbMcpServer(context: KbWriteContext, scopeRoot?: string) {
  const writeEnabled = isKbWriteEnabled();
  return createSdkMcpServer({
    name: "kb",
    version: "1.0.0",
    instructions:
      `Access to the ${subjectPrefix()}knowledge-base vault. Use kb_list to orient yourself, ` +
      "kb_search to find relevant files by keyword, and kb_read to read a specific file's " +
      "full contents. All paths are relative to the vault root." +
      (writeEnabled
        ? " kb_stage_edit/kb_stage_delete/kb_diff/kb_check/kb_discard/kb_submit are also " +
          "available for proposing changes. See their individual descriptions."
        : ""),
    // Without this, the SDK may defer these tools' schemas behind its
    // `ToolSearch` meta-tool once the visible tool count crosses its internal
    // threshold — but `ToolSearch` isn't on this portal's allow-list (see
    // lib/agent/permissions.ts), so a deferred kb_* tool would be permanently
    // undiscoverable: the model would ask ToolSearch for it, get denied, and
    // never learn the tool exists. Verified live — without `alwaysLoad: true`
    // the model called `ToolSearch` (denied) instead of `mcp__kb__kb_list`
    // directly and fell back to Glob/Read on the raw filesystem, never
    // touching the kb-mcp server at all. `alwaysLoad: true` keeps every
    // tool's schema in the prompt unconditionally.
    alwaysLoad: true,
    tools: [
      ...kbReadOnlyTools(scopeRoot),
      ...(writeEnabled ? createWriteTools(context) : []),
      ...(isIndexEnabled()
        ? [
            tool(
              "kb_index",
              "Return a generated map of every document in the knowledge base (titles + " +
                "one-line descriptions grouped by section) to orient before reading.",
              {},
              async () => ({
                content: [{
                  type: "text" as const,
                  text: scopeRoot
                    ? renderIndexMarkdown(buildIndex(scopeRoot))
                    : stagedIndexMarkdown(),
                }],
              }),
            ),
          ]
        : []),
    ],
  });
}
