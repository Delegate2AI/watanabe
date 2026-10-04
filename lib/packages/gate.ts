import type { HookCallback, HookJSONOutput, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { isPathWithinVault } from "@/lib/agent/permissions";

/**
 * The packages runner's PreToolUse gate — a deny-by-default confinement for
 * the headless integration job (see
 * docs/superpowers/specs/2026-07-09-update-package-ingestion-design.md § 3
 * and "Implementation deviations" #2). Unlike the interactive chat gate
 * (`lib/agent/permissions.ts`), which scopes Read/Glob/Grep to the single
 * live `vaultRoot()`, this job needs TWO roots: its own per-thread worktree
 * vault (where staged edits land — the session's cwd) and the uploaded
 * package's normalized directory (read-only source material, outside the
 * worktree entirely). The SDK has no "readable roots" option, so this module
 * is the whole containment check.
 */

/**
 * The two roots Read/Glob/Grep are confined to. `worktreeVault` is this job's
 * own thread's vault root (see `lib/repo-write.ts`'s `worktreeVaultRoot`);
 * `packageDir` is the uploaded package's normalized files directory (see
 * `lib/packages/config.ts`'s `packageDir`).
 */
export type PackagesRoots = { worktreeVault: string; packageDir: string };

/** Tool names whose input carries a filesystem path that must stay inside one of the two roots. */
const PATH_SCOPED_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep"]);

/**
 * Tools allowed outright, no path check: TodoWrite (in-memory, never touches
 * disk) and the read/staging `kb_*` tools the job needs to inspect the vault
 * and draft its edits. `kb_submit`/`kb_discard` are deliberately absent — the
 * RUNNER lands the change itself once the agent's final report is in (deny
 * reason below explains why), and a discard would delete the worktree
 * including the archive the runner pre-copied into it (deviation #4).
 */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([
  "TodoWrite",
  "mcp__kb__kb_list",
  "mcp__kb__kb_read",
  "mcp__kb__kb_search",
  "mcp__kb__kb_index",
  "mcp__kb__kb_stage_edit",
  "mcp__kb__kb_stage_delete",
  "mcp__kb__kb_diff",
]);

/**
 * Pull the filesystem path (if any) a Read/Glob/Grep call would target from
 * its raw `tool_input`. Read's field is `file_path`; Glob/Grep's is the
 * optional `path` (defaults to cwd, i.e. the worktree vault, when omitted —
 * "no path" is fine). Same field mapping as
 * `lib/agent/permissions.ts`'s `scopedToolTarget`.
 */
function scopedTarget(toolName: string, toolInput: unknown): string | undefined {
  if (!PATH_SCOPED_TOOLS.has(toolName)) return undefined;
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const input = toolInput as Record<string, unknown>;
  const raw = toolName === "Read" ? input.file_path : input.path;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * The authoritative PreToolUse decision for the packages runner.
 *
 * Read/Glob/Grep: allowed with no explicit target (cwd defaults to the
 * worktree vault) or when the target resolves inside EITHER root; a target
 * outside both, including a `../` escape from one root that doesn't happen to
 * land inside the other, is denied.
 *
 * `ALWAYS_ALLOWED` above (TodoWrite + the read/staging `kb_*` tools) is
 * allowed unconditionally. `kb_submit`, `kb_discard`, `Bash`, `WebSearch`,
 * `WebFetch`, and anything else not covered above is denied.
 */
export function gatePackagesTool(
  toolName: string,
  toolInput: unknown,
  roots: PackagesRoots,
): "allow" | "deny" {
  if (PATH_SCOPED_TOOLS.has(toolName)) {
    const target = scopedTarget(toolName, toolInput);
    if (target === undefined) return "allow";
    if (isPathWithinVault(target, roots.worktreeVault) || isPathWithinVault(target, roots.packageDir)) {
      return "allow";
    }
    return "deny";
  }
  return ALWAYS_ALLOWED.has(toolName) ? "allow" : "deny";
}

/** Human-readable denial reason surfaced to the model as `permissionDecisionReason`. */
function denyReason(toolName: string): string {
  if (toolName === "mcp__kb__kb_submit" || toolName === "mcp__kb__kb_discard") {
    return (
      `The runner lands this integration itself once your final report is in: "${toolName}" ` +
      `is never called by the model in this job. Finish staging your edits and write your ` +
      `final report instead.`
    );
  }
  if (toolName === "Bash") {
    return "This headless integration job has no shell access: read the package and vault, and stage edits through the kb_stage_edit/kb_stage_delete/kb_diff tools.";
  }
  if (toolName === "WebSearch" || toolName === "WebFetch") {
    return "This headless integration job has no web access: integrate only from the package's own content and the vault.";
  }
  return (
    `"${toolName}" is out of scope for this headless integration job, or its target path is ` +
    `outside both the job's worktree vault and the package directory.`
  );
}

/**
 * Wrap `gatePackagesTool` as an SDK PreToolUse `HookCallback`, in the exact
 * `hookSpecificOutput` shape `lib/agent/session.ts`'s `allowOutput`/
 * `denyOutput` use — copied, not re-derived, per that module's
 * runtime-verified note (the SDK's declared types are looser than what it
 * actually validates). This gate never returns `"ask"`: unlike the chat
 * gate's `kb_submit` confirm tier, every tool here is decided synchronously.
 */
export function createPackagesPreToolUse(roots: PackagesRoots): HookCallback {
  return async (input): Promise<HookJSONOutput> => {
    const { tool_name, tool_input } = input as PreToolUseHookInput;
    const verdict = gatePackagesTool(tool_name, tool_input, roots);
    if (verdict === "allow") {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denyReason(tool_name),
      },
    };
  };
}
