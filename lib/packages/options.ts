import type { CanUseTool, HookCallback, Options, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { createKbMcpServer } from "@/lib/kb-mcp/server";
import type { KbWriteContext } from "@/lib/kb-mcp/write-tools";
import { worktreeVaultRoot } from "@/lib/repo-write";
import { resolveAgentEnv } from "@/lib/agent/auth";
import { packagesMaxBudgetUsd, packagesMaxTurns } from "./config";
import { createPackagesPreToolUse, type PackagesRoots } from "./gate";
import { buildPackagesPrompt } from "./prompt";

/**
 * Model the packages runner's headless integration job runs on. Same env var
 * and default as the interactive chat agent (`lib/agent/config.ts`'s
 * `MODEL`) — one knob for both, deliberately not a separate
 * `PACKAGES_AGENT_MODEL`.
 */
const MODEL = process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8";

/** Vault-relative path the runner pre-copies a package's full contents to, verbatim, before the agent session starts. See lib/packages/prompt.ts's ARCHIVE section. */
function archiveRelPath(packageName: string): string {
  return `99-reference/handoffs/${packageName}/`;
}

/**
 * Build the SDK `Options` for one package's headless integration job —
 * mirrors `buildOptions` in `lib/agent/config.ts:302`, sized and scoped for
 * an unattended run over a whole document bundle rather than one interactive
 * chat turn:
 *
 * - `cwd` is this job's OWN per-thread worktree vault (`worktreeVaultRoot`),
 *   not the shared read-only `vaultRoot()` the chat agent uses — this job
 *   stages real edits into it via the `kb` MCP server's write tools.
 * - `systemPrompt` is the integration skill (`./prompt.ts`), not the chat
 *   assistant's persona.
 * - `allowedTools` stays at the read-only four (Read/Glob/Grep/TodoWrite);
 *   the `kb` MCP server's write/staging tools are reached via
 *   `mcp__kb__*`, same as chat.
 * - the PreToolUse hook is `./gate.ts`'s `createPackagesPreToolUse`, not
 *   `lib/agent/permissions.ts`'s chat gate — it confines Read/Glob/Grep to
 *   TWO roots (the worktree vault and the package directory) and denies
 *   `kb_submit`/`kb_discard`/`Bash`/web outright (the runner lands the
 *   change itself; see `./gate.ts`'s doc comment).
 * - `canUseTool` is a trivial deny-all: the gate above never returns
 *   `"confirm"`/`"ask"` for any tool in this job, so this callback is never
 *   actually invoked, but the SDK's `Options` shape requires one whenever
 *   `hooks.PreToolUse` is set.
 * - no `includePartialMessages` (nobody is streaming this to a browser) and
 *   no memory server (this is not a conversational session).
 * - `env` is `resolveAgentEnv()`, identical credential resolution to chat.
 */
export function buildPackagesOptions(p: {
  threadId: string;
  ownerEmail: string;
  ownerName?: string;
  packageDirAbs: string;
  packageName: string;
}): Options {
  const worktreeVault = worktreeVaultRoot(p.threadId);
  const roots: PackagesRoots = { worktreeVault, packageDir: p.packageDirAbs };
  const writeContext: KbWriteContext = {
    getThreadId: () => p.threadId,
    ownerEmail: p.ownerEmail,
    ownerName: p.ownerName,
  };
  const preToolUse: HookCallback = createPackagesPreToolUse(roots);
  // Never reached — the gate above always returns "allow" or "deny", never
  // "confirm"/"ask" — but Options requires a canUseTool whenever
  // hooks.PreToolUse is set.
  const canUseTool: CanUseTool = async (): Promise<PermissionResult> => ({
    behavior: "deny",
    message: "The packages runner never asks for interactive confirmation.",
  });

  return {
    model: MODEL,
    cwd: worktreeVault,
    settingSources: [],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: buildPackagesPrompt({
        packageName: p.packageName,
        packageDirAbs: p.packageDirAbs,
        archiveRelPath: archiveRelPath(p.packageName),
      }),
    },
    permissionMode: "default",
    allowedTools: ["Read", "Glob", "Grep", "TodoWrite"],
    mcpServers: { kb: createKbMcpServer(writeContext) },
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    canUseTool,
    maxBudgetUsd: packagesMaxBudgetUsd(),
    maxTurns: packagesMaxTurns(),
    env: resolveAgentEnv(),
  };
}
