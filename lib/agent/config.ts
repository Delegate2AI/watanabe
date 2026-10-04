import type { CanUseTool, HookCallback, McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import { vaultRootFor } from "@/lib/repo";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { getConfig } from "@/lib/config";
import { createKbMcpServer } from "@/lib/kb-mcp/server";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";
import { createMemMcpServer } from "@/lib/memory/mem-server";
import { isMemoryEnabled } from "@/lib/memory/config";
import { createDocMcpServer } from "@/lib/doc-mcp/server";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { createTasksMcpServer } from "@/lib/tasks/mcp";
import { isTasksEnabled } from "@/lib/tasks/config";
import { isProjectsEnabled } from "@/lib/projects/config";
import { isSkillsEnabled } from "@/lib/skills/config";
import { isDocCopilotEnabled } from "@/lib/shared-docs/config";
import { createCopilotMcpServer } from "@/lib/copilot-mcp/server";
import { isContentConfigured } from "@/lib/content/config";
import { createContentMcpServer } from "@/lib/content/mcp-server";
import { contentPrompt } from "@/lib/content/prompt";
import { docCopilotPrompt, type DocBinding } from "./copilot-prompt";

export type { DocBinding } from "./copilot-prompt";
export type { ModelChoiceInput } from "./model-options";
import { emailSlug } from "@/lib/memory/paths";
import { resolveAgentEnv } from "./auth";
import { ALLOWED_TOOLS, isKbWriteEnabled } from "./permissions";
import { getGitHost } from "@/lib/git-host";
import { buildSystemPrompt, externalResultsNote } from "./prompts";
import {
  resolveModelChoice,
  defaultModelId,
  isModelSwitchingEnabled,
  type ModelChoiceInput,
} from "./model-options";

/**
 * Hard per-session cutoffs handed to the SDK's `query()` (verified against
 * node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts: `maxBudgetUsd?: number`
 * at :1631, `maxTurns?: number` at :1626 — both top-level `Options` fields).
 * These are REAL limits, not effectively-infinite: they exist to stop a runaway
 * loop or cost blow-up on a SINGLE conversation while leaving generous headroom
 * for a long, legitimate research chat.
 *
 * - AGENT_MAX_BUDGET_USD (default $2.00): when a session's cost exceeds this, the
 *   SDK returns an `error_max_budget_usd` result instead of continuing. $2 is
 *   generous for a read-only KB chat (Opus reads + reasoning) yet caps the
 *   damage of a stuck loop.
 * - AGENT_MAX_TURNS (default 40): one turn = one user message + assistant
 *   response. 40 is a long back-and-forth for a research conversation, but low
 *   enough that a runaway tool loop trips it early.
 */
const DEFAULT_MAX_BUDGET_USD = 2.0;
const DEFAULT_MAX_TURNS = 40;

/**
 * Parse an env var into a finite POSITIVE number, else fall back to `fallback`.
 * Guards the SDK from a `NaN` (empty/malformed env) that would poison its limit
 * checks. `parse` is `parseFloat` for USD, `parseInt` for turn counts.
 */
function envPositiveNumber(
  raw: string | undefined,
  parse: (s: string) => number,
  fallback: number,
): number {
  const value = raw != null ? parse(raw.trim()) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}


/**
 * Build the Agent SDK options for one KB chat session.
 *
 * Scope is enforced two ways:
 *  - `allowedTools` fast-paths the six allow-listed tools (no gate round-trip).
 *  - the PreToolUse `hook` (deny-by-default; see session.ts → permissions.ts) is
 *    the AUTHORITATIVE gate: it allows Read/Glob/Grep/TodoWrite/WebSearch/
 *    WebFetch and the read-only `kb_*` tools, plus — only when
 *    `isKbWriteEnabled()` — the write/staging tools, plus a narrow tiered
 *    policy for Bash (`lib/agent/bash-policy.ts`), denying everything else.
 *    `allowedTools` alone can't do this — it's an auto-approve list, not a
 *    whitelist.
 *  - `canUseTool` (passed in by the caller — `AgentSession`, see session.ts)
 *    is what the SDK calls when the hook returns `"ask"` for `kb_submit`; it
 *    is always wired into `Options` here, but is only ever invoked when the
 *    hook actually emits `"ask"` — i.e. never, while write mode is off.
 *
 * `settingSources: []` loads NO repo settings, so nothing from a mounted repo's
 * own CLAUDE.md/instructions ever reaches this session — its identity comes
 * entirely from `buildSystemPrompt()` above.
 *
 * `mcpServers` wires in a fresh instance from `createKbMcpServer`
 * (`lib/kb-mcp/server.ts`) — an in-process MCP server exposing the read-only
 * `kb_list`/`kb_read`/`kb_search` tools always, plus the five write/staging
 * tools when write mode is enabled. `writeContext` is how those write tools
 * learn which thread/worktree and identity they're operating for (see
 * `KbWriteContext` — `AgentSession` constructs one bound to itself). Every
 * tool surfaces to the model as `mcp__kb__*`, which is the only `mcp__*`
 * prefix `lib/agent/permissions.ts`'s PreToolUse gate allows; every other MCP
 * server/tool is still denied by default.
 */
export function buildOptions(
  preToolUse: HookCallback,
  canUseTool: CanUseTool,
  writeContext: KbWriteContext,
  resume?: string,
  memoryContext?: string,
  clearanceSet: string[] = ["all-hands"],
  modelChoice?: ModelChoiceInput | null,
  projectContext?: string,
  connectorServers?: Record<string, McpServerConfig>,
  skillsPlugin?: { pluginPath: string; slugs: readonly string[] } | null,
  docBinding?: DocBinding | null,
  extras?: { adoptSessionId?: string; attachmentDir?: string },
): Options {
  // Read the cutoffs at call time (not module load) so env changes and tests are
  // reflected. Both helpers always resolve to a finite positive number (the
  // defaults are finite and positive), so both options are always safe to set.
  const maxBudgetUsd = envPositiveNumber(
    process.env.AGENT_MAX_BUDGET_USD,
    parseFloat,
    DEFAULT_MAX_BUDGET_USD,
  );
  const maxTurns = envPositiveNumber(
    process.env.AGENT_MAX_TURNS,
    (s) => parseInt(s, 10),
    DEFAULT_MAX_TURNS,
  );
  // The per-thread model/effort override (spec 24). DORMANT unless model
  // switching is enabled (AGENT_CHAT_MODELS configured): flag-off, we set
  // `model` exactly as before (the env default) and add NO `effort` field, so
  // the SDK option shape is byte-identical to pre-spec-24. Flag-on, the choice
  // is validated against the allowlist (an unknown model or effort falls back to
  // the env default at High) and applied. Either way the cost/turn ceilings
  // below are applied AFTER this and are unaffected, so no choice escapes them.
  const resolved = isModelSwitchingEnabled() ? resolveModelChoice(modelChoice) : null;
  const root = vaultRootFor(clearanceSet);
  // Spec 26: a project thread's context is appended after governance, before
  // memory. DORMANT unless PROJECTS_ENABLED is on: flag-off (or empty context)
  // the appended prompt is byte-identical to before. It is instructions only,
  // so it does NOT touch `root` (the clearance-derived vault cwd) above: a
  // project can never widen KB access beyond the thread owner's clearance.
  const projectPart =
    isProjectsEnabled() && projectContext && projectContext.trim() ? `\n\n${projectContext.trim()}` : "";
  // Spec 2026-08-27: a doc-bound copilot session. DORMANT unless the flag
  // chain is on AND the caller passed a binding: flag-off (or unbound) the
  // options are byte-identical, no prompt part and no `copilot` server. Its
  // own flag guard, NOT `projectPart`'s: coupling the copilot to the Projects
  // flag would dark-launch it on a deployment with projects off.
  const boundDoc = isDocCopilotEnabled() && docBinding ? docBinding : null;
  const copilotPart = boundDoc ? `\n\n${docCopilotPrompt(boundDoc)}` : "";
  // Spec 33: names of the external connectors active for this session. Empty
  // (no prompt note, no extra mcpServers entries) unless the session layer
  // actually resolved grants, so flag-off output stays byte-identical.
  const connectorNames = Object.keys(connectorServers ?? {});
  // the credential together (`isContentConfigured`), so a deployment with the
  // flag on but no key issued yet is byte-identical to one with the feature off:
  // no prompt section, no `content` server, nothing to advertise that cannot run.
  const contentReady = isContentConfigured();
  const contentPart = contentReady ? `\n\n${contentPrompt()}` : "";
  return {
    model: resolved ? resolved.model : defaultModelId(),
    ...(resolved ? { effort: resolved.effort } : {}),
    ...(extras?.adoptSessionId ? { sessionId: extras.adoptSessionId } : {}),
    cwd: root,
    ...(extras?.attachmentDir ? { additionalDirectories: [extras.attachmentDir] } : {}),
    settingSources: [],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        // `app.kbDescription` names the knowledge base this assistant serves
        // (spec 16). Read at call time, like the cutoffs above.
        buildSystemPrompt(isKbWriteEnabled(), getConfig().app.kbDescription, getConfig().agent, getGitHost().terms.long) +
        projectPart +
        copilotPart +
        contentPart +
        (memoryContext && memoryContext.trim() ? `\n\n${memoryContext.trim()}` : "") +
        // Spec 33: the external-results data-not-instructions note, only when
        // connectors are active (same append channel as the memory context).
        (connectorNames.length > 0 ? `\n\n${externalResultsNote(connectorNames)}` : ""),
    },
    permissionMode: "default",
    allowedTools: [...ALLOWED_TOOLS],
    mcpServers: {
      kb: createKbMcpServer(writeContext, isAuthorityEnabled() ? root : undefined),
      // `clearanceSet` scopes shared memory the same way it scopes the kb root
      // above and the tasks server below (spec 32): before this, `mem` was the
      // one server that received no clearance, so every authenticated user
      // could read all of memory/shared/**.
      ...(isMemoryEnabled()
        ? { mem: createMemMcpServer("read", emailSlug(writeContext.ownerEmail), clearanceSet) }
        : {}),
      // Spec 29: the `doc` MCP server (doc_write) is registered ONLY when the
      // canvas is enabled, so with the flag off the tool is not even present.
      // The permission gate re-checks the flag as a backstop (see permissions.ts).
      ...(isCanvasEnabled() ? { doc: createDocMcpServer(writeContext) } : {}),
      // Spec 21: the `tasks` MCP server (mcp__tasks__list) is registered ONLY
      // when tasks are enabled, so with the flag off the tool is not even
      // present and this spread contributes nothing (byte-identical config).
      // `clearanceSet` is the session's already-resolved clearance, passed
      // through so the read tool filters to what this owner may see.
      ...(isTasksEnabled()
        ? { tasks: createTasksMcpServer(writeContext.ownerEmail, { clearance: clearanceSet }) }
        : {}),
      // Spec 2026-08-27: the `copilot` server exists only for a doc-bound
      // session with the flag on; the gate's mcp__copilot__ branch is the
      // backstop. The binding is the closure: no tool takes a doc id.
      ...(boundDoc
        ? { copilot: createCopilotMcpServer({ docId: boundDoc.docId, ownerEmail: writeContext.ownerEmail }) }
        : {}),
      // Spec 2026-09-10: the `content` server. Its slug is reserved
      // (lib/connectors/types.ts) and its permission branch lives in
      // permissions-inproc-mcp.ts as the backstop to this registration.
      ...(contentReady ? { content: createContentMcpServer(writeContext) } : {}),
      // Spec 33: external connector servers merge LAST. Registered names
      // cannot collide with the in-process servers above: the reserved slugs
      // (kb/mem/doc/tasks) are rejected at registry parse.
      ...(connectorServers ?? {}),
    },
    includePartialMessages: true,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    canUseTool,
    maxBudgetUsd,
    maxTurns,
    ...(resume ? { resume } : {}),
    // Spec 34: the caller's materialized skills plugin, already filtered to the
    // skills this clearance may see (see lib/skills/materialize.ts), plus the
    // SDK's own allow-list of the skills it may run. `skills` is the SDK's
    // first-class control (sdk.d.ts:1881): unlisted skills are hidden from the
    // model's listing and rejected by the Skill tool, and it is the documented
    // replacement for putting `"Skill"` in `allowedTools`, which is deprecated
    // (sdk.d.ts:1321). It is a context filter, not a sandbox: the skill FILES
    // stay readable. That is fine here because materialization already keeps
    // another clearance's files physically absent from this directory, and the
    // PreToolUse gate re-checks the same slugs (lib/skills/permissions.ts).
    //
    // Both keys come from one materialization, so they can never disagree, and
    // both are omitted together. The flag is re-checked as a backstop, so with
    // SKILLS_ENABLED off these options are byte-identical to pre-spec-34 no
    // matter what a caller passes: no `plugins` and no `skills` key at all, not
    // an empty array and not an undefined value. An omitted `skills` leaves the
    // CLI's own defaults untouched, which is exactly today's behavior.
    ...(isSkillsEnabled() && skillsPlugin?.pluginPath && skillsPlugin.slugs.length > 0
      ? {
          plugins: [{ type: "local" as const, path: skillsPlugin.pluginPath }],
          skills: [...skillsPlugin.slugs],
        }
      : {}),
    env: resolveAgentEnv(),
  };
}
