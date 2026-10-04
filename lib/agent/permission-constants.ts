import path from "node:path";

/**
 * The tool-name sets, MCP prefixes, and containment helpers behind the agent
 * permission gate. Split out of `./permissions.ts` so the gate module stays
 * under the file-size limit; the security rationale lives with the gate
 * (`gateAgentTool`'s module docblock), and these are the vocabulary it
 * dispatches on. Public symbols that predate the split (`ALLOWED_TOOLS`,
 * `SUBMIT_TOOL`, `isAgentToolAllowed`, `isPathWithinVault`) are re-exported
 * from `./permissions.ts`, so importers are unchanged.
 */

/**
 * The only tools this agent may run outright. Read-only inspection of the
 * knowledge base, TodoWrite (in-memory task tracking — it never touches the
 * vault), and WebSearch/WebFetch (no filesystem/system access). Also handed
 * to the SDK as `allowedTools` so they fast-path the permission pipeline; the
 * gate is the authoritative check and classifies them identically.
 *
 * Bash is deliberately NOT in this list even though it's now enabled — it
 * needs a per-call decision (`lib/agent/bash-policy.ts`), not a blanket
 * auto-approve, so it's routed entirely through `gateAgentTool`.
 */
export const ALLOWED_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch"];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_TOOLS);

/** Tool names whose input carries a filesystem path that must stay inside the vault. */
const PATH_SCOPED_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep"]);

/**
 * The SDK prefixes every tool exposed by an in-process MCP server as
 * `mcp__<serverName>__<toolName>` (see `createSdkMcpServer` in
 * `lib/kb-mcp/server.ts`, registered under the name `"kb"`). This is a PREFIX
 * check, not a list of the three current tool names, so adding a fourth
 * `kb_*` tool to that server later needs no matching change here — it's
 * allowed by virtue of the server name, not enumerated individually. Every
 * OTHER `mcp__*` prefix (a future `mcp__evil__...`, or any server this portal
 * doesn't itself define) stays denied by the fallback in
 * `isAgentToolAllowed` below.
 */
export const MCP_KB_TOOL_PREFIX = "mcp__kb__";

/**
 * The five write/staging tools this portal's `kb` MCP server carries ONLY
 * when `isKbWriteEnabled()` — see `lib/kb-mcp/write-tools.ts`. Four of them
 * only ever touch a per-thread git worktree; `SUBMIT_TOOL` below is the one
 * that actually pushes and is singled out for the confirm tier.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "mcp__kb__kb_stage_edit",
  "mcp__kb__kb_stage_delete",
  "mcp__kb__kb_diff",
  "mcp__kb__kb_discard",
  "mcp__kb__kb_submit",
]);

/** The one write tool that pushes — the only tool this gate ever returns `"confirm"` for. */
export const SUBMIT_TOOL = "mcp__kb__kb_submit";

/** The only memory tools the interactive chat gate ever allows: read-only recall. */
export const MEM_READ_TOOLS: ReadonlySet<string> = new Set(["mcp__mem__mem_read", "mcp__mem__mem_list"]);
export const MCP_MEM_TOOL_PREFIX = "mcp__mem__";
export const TASKS_LIST_TOOL = "mcp__tasks__list";
export const MCP_TASKS_TOOL_PREFIX = "mcp__tasks__";

/**
 * Spec 29's in-chat document tool. `doc_write` is the ONLY `mcp__doc__*` tool,
 * and it is allowed only when `isCanvasEnabled()`: the belt-and-suspenders
 * backstop to the `doc` MCP server not being registered at all when the flag is
 * off (see `lib/agent/config.ts` and `lib/doc-mcp/server.ts`). Every other
 * `mcp__doc__*` name, and every `doc_write` call while the flag is off, is
 * denied so the tool can never become reachable when canvas is off.
 */
export const DOC_WRITE_TOOL = "mcp__doc__doc_write";
export const MCP_DOC_TOOL_PREFIX = "mcp__doc__";

/**
 * Is this tool inside scope? True for the six allow-listed tools above, plus
 * any tool from this portal's own `kb` MCP server (`mcp__kb__*` — see
 * `MCP_KB_TOOL_PREFIX`). Bash is handled separately by `gateAgentTool`
 * (never a flat `true` here — see `lib/agent/bash-policy.ts`). Everything
 * else — Edit, Write, MultiEdit, NotebookEdit, and any OTHER MCP server's
 * tools — is out of scope and must be denied.
 *
 * NOTE: this is necessary but not sufficient for Read/Glob/Grep — see
 * `isPathWithinVault` below for the argument-level check `gateAgentTool`
 * additionally applies to those three. The `kb_*` MCP tools enforce their own
 * vault-path scoping internally (see `lib/kb-mcp/tools.ts`), so no equivalent
 * argument-level check is needed here for the `mcp__kb__` prefix.
 */
export function isAgentToolAllowed(toolName: string): boolean {
  return ALLOWED_SET.has(toolName) || toolName.startsWith(MCP_KB_TOOL_PREFIX);
}

/**
 * Pull the filesystem path (if any) a Read/Glob/Grep call would target, from
 * its raw `tool_input` (typed `unknown` by the SDK — see PreToolUseHookInput).
 * Read's field is `file_path`; Glob/Grep's is the optional `path` (defaults to
 * cwd when omitted, which is already inside the vault, so "no path" is fine).
 */
export function scopedToolTarget(toolName: string, toolInput: unknown): string | undefined {
  if (!PATH_SCOPED_TOOLS.has(toolName)) return undefined;
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const input = toolInput as Record<string, unknown>;
  const raw = toolName === "Read" ? input.file_path : input.path;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * True when `candidate` (absolute or relative to `root`) resolves to `root`
 * itself or somewhere underneath it. Purely lexical (`path.resolve`), so it
 * catches the two ways the agent has actually been observed/expected to try
 * to escape the KB: an absolute path elsewhere on the host, and a `../`
 * traversal out of the vault. It does not resolve symlinks — a symlink placed
 * inside the vault that points outside it would not be caught; the KB
 * checkout this portal mounts doesn't contain any, but that's a real residual
 * gap if one were ever introduced.
 *
 * Exported so `lib/kb-mcp/tools.ts` (the `kb_list`/`kb_read`/`kb_search` MCP
 * tool handlers, used both in-process and over `/api/mcp`) can reuse the same
 * containment check instead of re-implementing path scoping — one function,
 * one place the "is this path actually inside the vault" logic can go wrong.
 */
export function isPathWithinVault(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isPathWithinAnyRoot(
  candidate: string,
  roots: readonly (string | undefined)[],
): boolean {
  return roots.some((root) => root !== undefined && isPathWithinVault(candidate, root));
}
