import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { getDb } from "@/lib/db/client";
import { copilotRead, copilotReviewState, copilotSuggest, type ToolOutcome } from "./tools";

/**
 * Build the in-process `copilot` MCP server (spec 2026-08-27), wired into the
 * chat agent via `Options.mcpServers` ONLY for a doc-bound session with
 * `isDocCopilotEnabled()` (see `lib/agent/config.ts`); the permission gate's
 * `mcp__copilot__` branch is the backstop. A fresh instance is built per
 * session because the tools close over the bound doc id and the acting user:
 * neither is ever tool input, so neither can be forged by the model.
 */
export interface CopilotServerContext {
  docId: string;
  ownerEmail: string;
}

function asContent<T>(outcome: ToolOutcome<T>) {
  if (!outcome.ok) return { content: [{ type: "text" as const, text: outcome.error }], isError: true };
  return { content: [{ type: "text" as const, text: JSON.stringify(outcome.result) }] };
}

export function createCopilotMcpServer(context: CopilotServerContext) {
  const ctx = () => ({ db: getDb(), docId: context.docId, ownerEmail: context.ownerEmail });
  return createSdkMcpServer({
    name: "copilot",
    version: "1.0.0",
    instructions:
      "You are working on one shared document. Read it with copilot_read, see its open " +
      "feedback with copilot_review_state, and propose every change as a suggestion with " +
      "copilot_suggest; a human accepts or rejects each suggestion in the review margin. " +
      "You cannot edit the document body or accept anything yourself.",
    // Keep the schema in the prompt unconditionally; see lib/kb-mcp/server.ts for
    // why alwaysLoad matters (ToolSearch is not on this portal's allow-list).
    alwaysLoad: true,
    tools: [
      tool(
        "copilot_read",
        "Read the bound document's latest markdown body, title, version, and your access tier. " +
          "Always re-read before proposing: a person may have edited it since your last look.",
        {},
        async () => asContent(copilotRead(ctx())),
      ),
      tool(
        "copilot_review_state",
        "The document's open comment threads and pending suggestions: the ground truth for " +
          "requests like addressing the outstanding feedback.",
        {},
        async () => asContent(copilotReviewState(ctx())),
      ),
      tool(
        "copilot_suggest",
        "Propose one edit as a reviewable suggestion. The quote must occur exactly once in the " +
          "current markdown source; on an ambiguity the error names the count, so extend the " +
          "quote and retry. Returns { suggestionId, baseVersion }.",
        {
          quote: z
            .string()
            .describe("The exact text to replace, copied verbatim from the document's markdown source, unique within it."),
          proposedText: z.string().describe("The replacement text. An empty string proposes deleting the quote."),
          note: z.string().optional().describe("A short rationale shown on the review card."),
        },
        async (args) => asContent(copilotSuggest(ctx(), args)),
      ),
    ],
  });
}
