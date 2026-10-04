import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { getDb } from "@/lib/db/client";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { scheduleRender } from "@/lib/render/schedule";
import { docWrite } from "./tools";

/**
 * Build the in-process `doc` MCP server (spec 29), wired into the chat agent via
 * `Options.mcpServers` ONLY when `isCanvasEnabled()` (see `lib/agent/config.ts`).
 * `createSdkMcpServer` runs the whole server in this same Node process, and the
 * SDK exposes its one tool to the model as `mcp__doc__doc_write` (server name
 * `"doc"`), which the permission gate (`lib/agent/permissions.ts`) allows only
 * when the flag is on: registration is the primary control, the gate is the
 * backstop, so the tool can never become reachable with the flag off.
 *
 * A fresh instance is built per `AgentSession` because the tool needs `context`
 * (the same `KbWriteContext` the write tools use) bound to that session's thread
 * and owner identity: `getThreadId()` is a live getter (see
 * `AgentSession.effectiveThreadId`).
 */
export function createDocMcpServer(context: KbWriteContext) {
  return createSdkMcpServer({
    name: "doc",
    version: "1.0.0",
    instructions:
      "Capture a standalone document (a one-pager, draft section, or memo) the user will " +
      "keep, publish, or share, instead of writing it inline in chat. Call doc_write with a " +
      "new document's title and body; to revise it, call doc_write again with the same docId.",
    // Keep the schema in the prompt unconditionally; see lib/kb-mcp/server.ts for
    // why alwaysLoad matters (ToolSearch is not on this portal's allow-list).
    alwaysLoad: true,
    tools: [
      tool(
        "doc_write",
        "Create or revise a standalone chat document that opens in the canvas pane beside the " +
          "chat. With no docId, creates a new document (version 1) bound to this conversation. " +
          "With a docId, appends a new version to that document. Returns { docId, version }.",
        {
          title: z
            .string()
            .optional()
            .describe("Title for a NEW document. Ignored on a revision. Derived from the first heading if omitted."),
          body: z.string().describe("The full body of this version of the document, in the chosen format."),
          docId: z
            .string()
            .optional()
            .describe("Omit to create a new document; pass an existing document's id to append a new version to it."),
          // ALWAYS in the schema, never conditionally omitted. Leaving it out
          // when the flag is off does not stop the model sending it: zod strips
          // an unknown key rather than rejecting it, so `format: "html"` reached
          // the tool as a bare body, took the markdown default, and stored the
          // HTML mislabelled. Only the description changes with the flag, so an
          // off deployment does not advertise a format it will refuse while the
          // refusal itself still happens where it can be seen.
          format: z
            .enum(["md", "html"])
            .optional()
            .describe(
              isHtmlDocumentsEnabled()
                ? "md (default) for a normal document. html for a designed, art-directed page: " +
                  "a full standalone HTML document with its own inline CSS. See the design " +
                  "guidance in the system prompt before choosing html."
                : "md (default). Only md is available in this deployment.",
            ),
        },
        async (args) => {
          try {
            const result = docWrite(
              { db: getDb(), getThreadId: context.getThreadId, ownerEmail: context.ownerEmail },
              args,
            );
            // Arms a debounced render of the three downloadable files. Returns
            // synchronously and cannot throw, so the tool call does not wait on
            // Chromium and a render failure never reaches the model as an error:
            // the document is already saved by this point.
            scheduleRender({
              ownerEmail: context.ownerEmail,
              docId: result.docId,
              version: result.version,
              title: result.title,
              body: args.body,
              format: result.format,
            });
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          } catch (e) {
            return {
              content: [{ type: "text" as const, text: e instanceof Error ? e.message : "doc_write failed" }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
