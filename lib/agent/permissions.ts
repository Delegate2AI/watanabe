import { vaultRoot } from "@/lib/repo";
import { isMemoryEnabled } from "@/lib/memory/config";
import { isTasksEnabled } from "@/lib/tasks/config";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { effectiveCanWrite, isKbWriteEnabled } from "@/lib/authority/write-gate";
import { gateBashCommand, bashDenialReason, type BashInputLike } from "./bash-policy";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { parseExternalMcpTool, gateExternalMcpTool } from "@/lib/connectors/permissions";
import { isSkillsEnabled } from "@/lib/skills/config";
import { gateSkillTool, skillDenialReason, SKILL_TOOL } from "@/lib/skills/permissions";
import { gateInProcessMcpTool } from "./permissions-inproc-mcp";
import {
  DOC_WRITE_TOOL,
  MCP_DOC_TOOL_PREFIX,
  MCP_MEM_TOOL_PREFIX,
  MCP_TASKS_TOOL_PREFIX,
  MEM_READ_TOOLS,
  SUBMIT_TOOL,
  TASKS_LIST_TOOL,
  WRITE_TOOL_NAMES,
  isAgentToolAllowed,
  isPathWithinAnyRoot,
  scopedToolTarget,
} from "./permission-constants";
import { subjectPrefix } from "@/lib/config/subject";

export { isKbWriteEnabled } from "@/lib/authority/write-gate";
export { parseExternalMcpTool } from "@/lib/connectors/permissions";
// The gate's vocabulary lives in ./permission-constants (file-size split);
// the public names keep this module as their import path.
export { ALLOWED_TOOLS, SUBMIT_TOOL, isAgentToolAllowed, isPathWithinVault, isPathWithinAnyRoot } from "./permission-constants";

/**
 * Tool-scope guardrail for the KB chat agent — the security boundary that keeps
 * it read-only by default, and the single place write capability (when
 * enabled) is switched on.
 *
 * By default (KB_WRITE_ENABLED unset) this portal has NO write tools at all:
 * the agent can inspect the knowledge-base vault (Read/Glob/Grep, and the
 * read-only `kb` MCP server's `kb_list`/`kb_read`/`kb_search` — see
 * `lib/kb-mcp/`), track its own todos (TodoWrite), and search/fetch the open
 * web (WebSearch/WebFetch — no filesystem or system access, so no containment
 * concern applies to them the way it does for Read/Glob/Grep). Bash gets its
 * own narrow, tiered policy (see `lib/agent/bash-policy.ts`) rather than a
 * flat allow — most Bash calls still require confirmation. Edit, Write,
 * MultiEdit, NotebookEdit, and any MCP tool from a server OTHER than this
 * portal's own `kb` server are denied outright so a future addition can't
 * silently slip through: raw file mutation only ever happens through the
 * staged/diffable/confirm-gated `kb_stage_edit`/`kb_stage_delete`/`kb_submit`
 * tools, never a generic SDK-native write.
 *
 * When `KB_WRITE_ENABLED=1` (see `isKbWriteEnabled` below), this portal's own
 * `kb` MCP server ALSO carries five staging/write tools
 * (`kb_stage_edit`/`kb_stage_delete`/`kb_diff`/`kb_discard`/`kb_submit` — see
 * `lib/kb-mcp/write-tools.ts`). Four of them are allowed outright (they only
 * ever touch a per-thread git worktree, never the live checkout); `kb_submit`
 * — the only tool that actually pushes — is the one "confirm" case: it must
 * be approved by the thread's owner before it runs (see
 * `lib/agent/session.ts`'s `canUseTool`, which the SDK invokes when this
 * gate's `"ask"` decision is returned for it).
 *
 * Why a gate and not just config: the SDK's `allowedTools` is only an
 * auto-approve list; it does NOT remove tools from the agent's context, and
 * does not stop the model from attempting a tool that isn't on that list. So
 * this deny-by-default function — wired as the session's PreToolUse hook — is
 * what actually enforces the read-only (or read+confirmed-write) scope. The
 * scope is code, not prompt wording.
 *
 * Tool-name allow-listing alone is NOT sufficient: `Read`/`Glob`/`Grep` accept
 * an arbitrary filesystem path as an argument (Read's `file_path` is an
 * absolute path; Glob/Grep's `path` defaults to cwd but can point anywhere),
 * and the SDK does not confine them to `cwd`. Without an argument-level check,
 * an allow-listed tool name is a general-purpose "read any file this process
 * can see" primitive — verified live: the agent successfully used `Read` to
 * pull a file from outside the mounted KB checkout entirely (an operator's
 * unrelated `~/.claude/projects/.../memory/*.md` file). `isPathWithinVault`
 * below closes that: any Read/Glob/Grep target must resolve inside
 * `vaultRoot()`, or the call is denied exactly like an unlisted tool would be.
 * Scoping to the vault (rather than the whole cloned repo) also keeps the
 * agent out of the repo's own plumbing — its `.git`, `.obsidian`, build
 * scripts, etc. — when `VAULT_SUBDIR` narrows the vault to a subdirectory.
 * The write tools apply the identical containment check against their own
 * worktree's vault root instead (see `lib/kb-mcp/write-tools.ts`).
 */

/**
 * The session gate — the authoritative PreToolUse decision.
 *
 * Write tools (`WRITE_TOOL_NAMES`) are checked FIRST, ahead of the generic
 * `mcp__kb__` prefix allow below (they share that prefix, but need their own
 * flag/confirm handling, not the plain allow every other `kb_*` tool gets):
 * denied outright when `isKbWriteEnabled()` is false; when true, `kb_submit`
 * (`SUBMIT_TOOL`) returns `"confirm"` — the SDK surfaces this as an `"ask"`
 * PreToolUse decision, which routes to `AgentSession`'s `canUseTool` callback
 * (see `lib/agent/session.ts`) — and the other four write tools return
 * `"allow"` (they only ever touch a per-thread git worktree, never the live
 * checkout, so no confirmation is needed to stage a draft).
 *
 * `Bash` is checked next, ahead of `isAgentToolAllowed` — it's deliberately
 * NOT in `ALLOWED_TOOLS`/`ALLOWED_SET` (never a flat allow), always routed
 * through `gateBashCommand`'s own tiered policy (see `./bash-policy`). No
 * `threadId` at all (shouldn't happen in practice — `AgentSession` always has
 * one — but defense in depth) denies outright rather than guessing.
 *
 * Everything else keeps its Phase-1 shape: allow-listed tools (Read/Glob/Grep/
 * TodoWrite/WebSearch/WebFetch, plus the read-only `kb_*` tools) run freely
 * UNLESS Read/Glob/Grep target a path outside `vaultRoot()`, in which case
 * they're denied exactly like an unlisted tool. Everything not covered above
 * is denied outright.
 */
export function gateAgentTool(
  toolName: string,
  toolInput?: unknown,
  threadId?: string,
  scopeRoot?: string,
  ownerEmail?: string,
  connectorAllow?: ReadonlyMap<string, ReadonlySet<string> | "all">,
  skillSlugs?: ReadonlySet<string>,
  attachmentRoot?: string,
): "allow" | "deny" | "confirm" {
  if (toolName.startsWith(MCP_MEM_TOOL_PREFIX)) {
    // Chat may recall (read) memory when enabled; it may NEVER write/delete
    // memory (that happens only in the server-side dream/remember process).
    return isMemoryEnabled() && MEM_READ_TOOLS.has(toolName) ? "allow" : "deny";
  }
  if (toolName.startsWith(MCP_TASKS_TOOL_PREFIX)) {
    return isTasksEnabled() && toolName === TASKS_LIST_TOOL ? "allow" : "deny";
  }
  if (toolName.startsWith(MCP_DOC_TOOL_PREFIX)) {
    return isCanvasEnabled() && toolName === DOC_WRITE_TOOL ? "allow" : "deny";
  }
  // not the external-connector path below, decides every one of their names.
  const inProcess = gateInProcessMcpTool(toolName);
  if (inProcess !== null) return inProcess;
  // Spec 33: external connector tools (any non-reserved mcp__ slug). Callers
  // that pass no allow-map keep today's deny for every such name.
  const external = parseExternalMcpTool(toolName);
  if (external) return gateExternalMcpTool(external, connectorAllow);
  if (WRITE_TOOL_NAMES.has(toolName)) {
    if (!effectiveCanWrite(ownerEmail ?? "")) return "deny";
    return toolName === SUBMIT_TOOL ? "confirm" : "allow";
  }
  if (toolName === "Bash") {
    if (threadId === undefined) return "deny";
    // `skillSlugs` scopes spec 34's skill-script carve-out to the skills THIS
    // caller materialized, so it cannot become a Bash path around the gate below.
    const write = effectiveCanWrite(ownerEmail ?? "");
    return gateBashCommand(toolInput as BashInputLike, threadId, write, scopeRoot, skillSlugs, attachmentRoot);
  }
  // Spec 34: the SDK's Skill tool. Checked against the slugs the session
  // materialized for THIS caller, independently of what the plugin directory
  // holds (see lib/skills/permissions.ts). Callers that pass no set keep
  // today's deny, since `Skill` is not in `ALLOWED_TOOLS`.
  if (toolName === SKILL_TOOL) return gateSkillTool(toolInput, skillSlugs);
  if (!isAgentToolAllowed(toolName)) return "deny";
  const target = scopedToolTarget(toolName, toolInput);
  if (target !== undefined && !isPathWithinAnyRoot(target, [scopeRoot ?? vaultRoot(), attachmentRoot])) return "deny";
  return "allow";
}

/**
 * Human-readable denial reason handed back to the agent (as the PreToolUse
 * `permissionDecisionReason`) so it self-corrects and tells the user, instead
 * of silently retrying a blocked call.
 */
export function denialReason(toolName: string, toolInput?: unknown, scopeRoot?: string, attachmentRoot?: string): string {
  if (toolName.startsWith(MCP_MEM_TOOL_PREFIX)) {
    return (
      `This assistant can read persistent memory but cannot modify it directly; ` +
      `memory is written only by the portal's own consolidation process.`
    );
  }
  // Both feature-specific sentences are gated on their own flag, so a portal with
  // the feature off never names it: they fall through to the generic read-only
  // text below, byte-identical to the pre-spec-33/34 reason. Verdicts are unchanged.
  if (isConnectorsEnabled() && parseExternalMcpTool(toolName)) return `connector not enabled for this thread`;
  if (WRITE_TOOL_NAMES.has(toolName) && !isKbWriteEnabled()) {
    return (
      `Write mode is not enabled for this knowledge-base assistant, so it cannot run ` +
      `\`${toolName}\`. It can only read, search, and cross-reference the knowledge base.`
    );
  }
  if (toolName === "Bash") {
    return bashDenialReason((toolInput as BashInputLike) ?? {});
  }
  if (isSkillsEnabled() && toolName === SKILL_TOOL) return skillDenialReason(toolInput);
  const target = scopedToolTarget(toolName, toolInput);
  if (target !== undefined && !isPathWithinAnyRoot(target, [scopeRoot ?? vaultRoot(), attachmentRoot])) {
    return (
      `This assistant is scoped to the ${subjectPrefix()}knowledge-base checkout only, ` +
      `so it cannot run \`${toolName}\` on \`${target}\` — that path is outside the ` +
      `knowledge base. It can only read files inside the mounted KB checkout.`
    );
  }
  return (
    `This assistant is read-only and scoped to the ${subjectPrefix()}knowledge base, ` +
    `so it cannot run \`${toolName}\`. It can read files, search the knowledge base ` +
    `(Read / Glob / Grep), track its own todos (TodoWrite), search/fetch the web ` +
    `(WebSearch / WebFetch), and run a narrow set of read-only shell commands — ` +
    `it cannot edit or write files, or call any other external tool.`
  );
}
