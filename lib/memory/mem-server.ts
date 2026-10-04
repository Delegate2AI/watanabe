import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { memDelete, memList, memRead, memWrite, type MemScope } from "./mem-tools";

/**
 * In-process MCP server for the memory store, mirroring `lib/kb-mcp/server.ts`.
 * Tools surface as `mcp__mem__*`. `alwaysLoad: true` for the same reason the kb
 * server needs it: without it the SDK may defer tool schemas behind `ToolSearch`,
 * which this portal's gate denies, making the tools permanently undiscoverable.
 *
 * Two modes: chat sessions get "read" (recall only); the server-side dream/
 * remember process gets "full" (read + write + delete). The chat gate never
 * allows a mem write tool, so writes cannot leak into interactive chat.
 *
 * `ownerSlug` plus `clearance` scope EVERY tool this server exposes, reads
 * included, to `memory/users/<ownerSlug>/**` and the `memory/shared/<group>/**`
 * directories the caller is cleared for (see `MemScope` in `./scope`). So
 * neither an interactive chat session nor the dream's `bypassPermissions`
 * session can reach another user's subtree or a group the owner is not in (the
 * dream cannot be steered there by a prompt-injected transcript; a chat user
 * cannot simply ask for it directly).
 *
 * Left `undefined` (the argument omitted entirely), every tool runs unscoped
 * (not expected in production; kept for callers that construct a server
 * without an owner). Passing an empty string is treated as an explicit scope,
 * not as "no scope": it does NOT fall back to unscoped access (that would be
 * fail-open), and the checks in `./scope` deny every `memory/users/**` path
 * for it instead.
 *
 * `clearance` defaults to `[]`, which grants nothing under `memory/shared/`
 * (spec 32 D32.4). A caller that passes an owner but forgets clearance
 * therefore fails closed rather than seeing every group.
 */
export function createMemMcpServer(mode: "read" | "full", ownerSlug?: string, clearance: string[] = []) {
  // `ownerSlug !== undefined` (not a truthiness check): an empty string is
  // still an explicit scope value, not "no scope". A truthiness check would
  // make an empty slug silently fall back to the unscoped (fully open)
  // branch below; see the empty-slug fail-closed handling in
  // `isOwnPrivatePath` (./scope), used by all three scope predicates, for what
  // actually happens with `""`.
  const scope: MemScope | undefined = ownerSlug !== undefined ? { ownerSlug, clearance } : undefined;
  const readTools = [
    tool(
      "mem_list",
      "List entries under a path in the memory store (relative to the memory root, e.g. \"memory/shared\").",
      { path: z.string().optional().describe('Memory-relative path. Defaults to "memory".') },
      async (args) => memList(args, scope),
    ),
    tool(
      "mem_read",
      "Read a memory file's full contents by its memory-relative path (markdown only).",
      { path: z.string().describe('e.g. "memory/shared/tokenomics.md".') },
      async (args) => memRead(args, scope),
    ),
  ];
  // Belt-and-suspenders, matching the original write-side check: write tools
  // are only ever included in the returned server when mode === "full" (see
  // the `tools:` line below), but the scope passed to their closures is
  // re-guarded here too, so the two can never drift independently.
  const writeScope = mode === "full" ? scope : undefined;
  const writeTools = [
    tool(
      "mem_write",
      "Create or overwrite a memory file (markdown only). Used only by the consolidation process.",
      { path: z.string().describe("memory-relative .md path"), content: z.string().describe("full file contents") },
      async (args) => memWrite(args, writeScope),
    ),
    tool(
      "mem_delete",
      "Delete a stale memory file (markdown only). Used only by the consolidation process.",
      { path: z.string().describe("memory-relative .md path") },
      async (args) => memDelete(args, writeScope),
    ),
  ];
  return createSdkMcpServer({
    name: "mem",
    version: "1.0.0",
    instructions:
      "The portal's persistent memory store. Use mem_list/mem_read to recall prior context." +
      (mode === "full" ? " Use mem_write/mem_delete to consolidate and prune during a dream." : ""),
    alwaysLoad: true,
    tools: mode === "full" ? [...readTools, ...writeTools] : readTools,
  });
}
