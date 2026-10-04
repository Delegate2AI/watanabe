import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { errorResult, kbList, kbRead, kbSearch, textResult } from "@/lib/kb-mcp/tools";
import { createWriteTools, type KbWriteContext } from "@/lib/kb-mcp/write-tools";
import { isKbWriteEnabled } from "@/lib/agent/permissions";
import { can } from "@/lib/authority/roles";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import {
  sharedDocAttach,
  sharedDocCreate,
  sharedDocUpdate,
  type SharedDocToolContext,
  type ToolOutcome,
} from "@/lib/shared-docs/mcp-tools";
import { vaultRootFor } from "@/lib/repo";
import { mcpActorFor, type ServiceContext } from "@/lib/service/actor";
import { isTaskCommentsEnabled, isTasksEnabled } from "@/lib/tasks/config";
import { taskCommentTools } from "@/lib/tasks/mcp-comment-tools";
import { taskTools } from "@/lib/tasks/mcp-tools";
import { contentTools } from "@/lib/content/mcp-tools";
import { isContentConfigured } from "@/lib/content/config";
import { registerServiceTools } from "./register";

/**
 * Build a fresh MCP server exposing the same three read-only vault tools as
 * the in-process `kb` server. A new instance is created per MCP session (see
 * the route's `getOrCreateSession`). `McpServer` instances are cheap and are
 * not meant to be shared across independent client connections.
 *
 * The server is bound to ONE caller, and every tool reads at that caller's
 * projection. Absence is the boundary: a file outside it is not found, never
 * refused with a reason (spec 19).
 *
 * A privileged session also gets the five staging tools, bound to its OWN
 * thread id so two clients get two worktrees and cannot see each other's staged
 * edits, exactly as two chat threads cannot. Registration is the control: an
 * unprivileged caller never sees a write tool's schema.
 *
 * `kb_index` is deliberately absent. It renders the chat orientation map, and
 * `kb_list` reaches the same information.
 *
 * Exported for the test, which drives the registered tools directly rather than
 * standing up the transport.
 */
export function buildServer(
  ownerEmail: string,
  write?: { threadId: string },
): McpServer {
  // Per call, not once here: a session outlives a request, and a person's group
  // membership can be taken away while theirs is still open. `vaultRootFor`
  // keys its projection cache on the access version, so this is a cache hit.
  const scopeRoot = () => vaultRootFor(resolveClearance(ownerEmail, loadGroups()));
  const server = new McpServer({ name: "kb", version: "1.0.0" });

  server.registerTool(
    "kb_list",
    {
      description:
        "List files and subdirectories under a path in the knowledge-base vault. Non-recursive by default.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('Path relative to the vault root, e.g. "02-market-and-research". Defaults to the vault root (".").'),
        recursive: z
          .boolean()
          .optional()
          .describe("List the full subtree instead of just the immediate children. Defaults to false."),
      },
      annotations: { title: "List vault entries", readOnlyHint: true, openWorldHint: false },
    },
    async (args) => kbList(args, scopeRoot()),
  );

  server.registerTool(
    "kb_read",
    {
      description:
        "Read the full contents of one file in the knowledge-base vault by its vault-relative path. Text " +
        "files only (e.g. .md); rejects binary or oversized (>1MB) files with a clear error.",
      inputSchema: {
        path: z.string().describe('File path relative to the vault root, e.g. "04-economy/tokenomics.md".'),
      },
      annotations: { title: "Read a vault file", readOnlyHint: true, openWorldHint: false },
    },
    async (args) => kbRead(args, scopeRoot()),
  );

  server.registerTool(
    "kb_search",
    {
      description:
        "Search the knowledge-base vault for a text query (case-insensitive substring match) and return " +
        "matching file paths with line snippets. Optionally scope to a subdirectory. Capped at 50 matches.",
      inputSchema: {
        query: z.string().describe("Text to search for."),
        path: z
          .string()
          .optional()
          .describe('Restrict the search to this vault-relative path. Defaults to the whole vault (".").'),
      },
      annotations: { title: "Search the vault", readOnlyHint: true, openWorldHint: false },
    },
    async (args) => kbSearch(args, scopeRoot()),
  );

  // Two gates, not one boolean. Passing `write` at all says the credential
  // class may hold write tools; each domain's own flag says whether that
  // domain exists here; and `can` says whether this person may write, checked
  // live rather than frozen into the credential. `kb_submit` checks the same
  // capability again itself, so a tool that would always refuse never appears.
  const mayWrite = write !== undefined && can(ownerEmail, "write");
  if (mayWrite && isKbWriteEnabled()) registerWriteTools(server, ownerEmail, write.threadId);
  if (mayWrite && isSharedDocsEnabled()) registerSharedDocTools(server, ownerEmail);

  // `write !== undefined`, NOT `mayWrite`: a vault merge request needs a role
  // somebody was given, a person's own tasks do not, and asking here would hide
  // them for want of a line in roles.yaml. Hence `mcpActorFor`'s editor floor,
  // which stops there: approve and manageAccess still need a real role. Comments
  // carry their own flag because with it off these three could only refuse.
  if (write !== undefined) {
    const context = (): ServiceContext => ({ db: getDb(), actor: mcpActorFor(ownerEmail) });
    if (isTasksEnabled()) {
      registerServiceTools(server, taskTools(), context);
      if (isTaskCommentsEnabled()) registerServiceTools(server, taskCommentTools(), context);
    }
    // Spec 2026-09-10. `isSharedDocsEnabled` as well as the content gate,
    // because on this surface a result lands in a shared document: with shared
    // docs off there is nowhere for it to go, so the tools would queue paid work
    // into a document nobody can open. Gated on the CREDENTIAL too, so a
    // nothing, exactly as the chat surface does.
    if (isContentConfigured() && isSharedDocsEnabled()) {
      registerServiceTools(server, contentTools(), context);
    }
  }
  return server;
}

/**
 * The chat agent's own staging tools, re-registered on this transport. The
 * definitions are reused verbatim from `lib/kb-mcp/write-tools.ts`, so the
 * worktree lifecycle, the quality gates and the merge-request path are the same
 * code an in-chat proposal goes through.
 */
function registerWriteTools(server: McpServer, ownerEmail: string, threadId: string): void {
  const context: KbWriteContext = { getThreadId: () => threadId, ownerEmail, forceMergeRequest: true };
  for (const definition of createWriteTools(context)) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.inputSchema },
      definition.handler,
    );
  }
}

function outcomeResult<T>(outcome: ToolOutcome<T>): CallToolResult {
  return outcome.ok ? textResult(JSON.stringify(outcome.result)) : errorResult(outcome.error);
}

function registerSharedDocTools(server: McpServer, ownerEmail: string): void {
  const ctx = (): SharedDocToolContext => ({ db: getDb(), ownerEmail });

  server.registerTool(
    "shared_doc_create",
    {
      description:
        "Create a shared document owned by you, seeded with the given title and body. Returns its id and " +
        "version. To place it on a project afterwards, use shared_doc_attach.",
      inputSchema: {
        title: z.string().describe("The document's title, as it appears in the document list."),
        body: z.string().describe("The full document body."),
      },
      annotations: { title: "Create a shared document", readOnlyHint: false, openWorldHint: false },
    },
    async (args) => outcomeResult(sharedDocCreate(ctx(), args)),
  );

  server.registerTool(
    "shared_doc_update",
    {
      description:
        "Update a shared document you can reach: pass a body to append a new version, a title to rename it " +
        "(owner only), or neither to check your access and read back the current version number without " +
        "writing anything.",
      inputSchema: {
        docId: z.string().describe("The document's id, as returned by shared_doc_create."),
        title: z.string().optional().describe("A new title. Requires ownership."),
        body: z.string().optional().describe("The complete new body. Appended as a new version."),
      },
      annotations: { title: "Update a shared document", readOnlyHint: false, openWorldHint: false },
    },
    async (args) => outcomeResult(sharedDocUpdate(ctx(), args)),
  );

  server.registerTool(
    "shared_doc_attach",
    {
      description:
        "Attach a shared document you can reach to a project you can see. Idempotent: re-attaching the same " +
        "document reports attached=false rather than duplicating it.",
      inputSchema: {
        projectId: z.string().describe("The project's id."),
        docId: z.string().describe("The document's id."),
      },
      annotations: { title: "Attach a document to a project", readOnlyHint: false, openWorldHint: false },
    },
    async (args) => outcomeResult(sharedDocAttach(ctx(), args)),
  );
}

