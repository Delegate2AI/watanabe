import path from "node:path";
import { repoRoot } from "@/lib/repo";
import { isSafeThreadId, worktreePath } from "@/lib/repo-write";
import { isSkillScriptInvocation } from "@/lib/skills/script-policy";
import {
  DESTRUCTIVE,
  INTERPRETER,
  MUTATING_GIT,
  NETWORK_EGRESS,
  PRIVILEGE_OR_PROCESS,
  SECRET_ACCESS,
  SHELL_METACHARACTERS,
} from "./bash-patterns";

/**
 * Bash gets a materially different shape of policy than every other tool in
 * `./permissions` — command-string parsing across several independent
 * pattern tiers, rather than one static name → verdict decision — so it
 * lives in its own module (mirroring `lib/kb-mcp/write-tools.ts` sitting
 * beside `lib/kb-mcp/tools.ts`) instead of ballooning `permissions.ts`.
 *
 * The shape, checked in order:
 *  - Tier 0 (`isHardDenied`): unambiguously dangerous — secret/env
 *    exfiltration, network egress, destructive/mutating commands, privilege
 *    escalation, shell chaining/substitution/redirection, or an interpreter
 *    that could trivially run any of the above indirectly. Hard `"deny"` —
 *    this NEVER reaches the confirm dialog. A human clicking "allow" on a
 *    deceptively-worded prompt is not an acceptable boundary for these. The
 *    patterns themselves live in `./bash-patterns`, shared with spec 34's
 *    skill-script carve-out (`lib/skills/script-policy.ts`), which relaxes
 *    exactly one of them and re-applies the rest.
 *  - Tier 1 (`READONLY_GIT`): a narrow, fully-anchored allowlist of read-only
 *    `git` history/diff/status commands, scoped to either the shared live
 *    repo (`repoRoot()` — safe in any mode, it's the same already-public
 *    content `kb_read`/`kb_list` expose, just with history) or, only when
 *    write mode is on, the CALLING THREAD'S OWN worktree
 *    (`worktreePath(threadId)`) — never another thread's. Auto `"allow"`.
 *  - Tier 2: anything else falls through to `"confirm"` — the existing
 *    `canUseTool` UI, identical to `kb_submit`'s plumbing today.
 *
 * RESIDUAL RISK — read before trusting this as a hard sandbox boundary:
 * this is command-STRING pattern matching, not an OS-level sandbox; the SDK
 * spawns a real shell. Regex tokenizing is inherently incomplete (quoting,
 * `$IFS`, unicode look-alikes, and embedded variable expansion can all defeat
 * naive keyword matching) — Tier 0's matching is deliberately broad and
 * substring-based specifically to fail CLOSED against cleverness, not to
 * guarantee catching a deliberately adversarial string. The Tier-2 confirm
 * gate still ultimately trusts a human reading a JSON-dumped command in a
 * modal — a command whose EFFECT is misleading despite benign-looking TEXT is
 * not closed by this design (an accepted trade-off for Tier 2; NOT accepted
 * for Tier 0, which is why those are hard-denied instead of routed to
 * confirm). Path-containment (Tier 1) is exactly as strong as
 * `isPathWithinVault`'s existing lexical-only check — no symlink resolution.
 */

export type BashVerdict = "allow" | "deny" | "confirm";

export type BashInputLike = {
  command?: unknown;
  dangerouslyDisableSandbox?: unknown;
};

function isHardDenied(command: string, dangerouslyDisableSandbox: boolean): boolean {
  if (dangerouslyDisableSandbox) return true;
  return (
    SHELL_METACHARACTERS.test(command) ||
    SECRET_ACCESS.test(command) ||
    NETWORK_EGRESS.test(command) ||
    DESTRUCTIVE.test(command) ||
    MUTATING_GIT.test(command) ||
    PRIVILEGE_OR_PROCESS.test(command) ||
    INTERPRETER.test(command)
  );
}

/**
 * `git -C <path> {log,diff,show,status,branch}`, and nothing else — no
 * `ls`/`cat`/`head`/`tail`/`grep`/`find` at launch. Validating "every
 * path-like argument in an arbitrary-flag-shape command resolves inside
 * root" for those is exactly the kind of command-matching that isn't a real
 * boundary; ship the narrowest defensible allowlist first, widen later with
 * real usage data (see module doc comment).
 */
const READONLY_GIT = /^git -C (\S+) (log|diff|show|status|branch)(\s.*)?$/;

/**
 * Same lexical-only (no symlink resolution) root-containment logic as
 * `./permissions`'s `isPathWithinVault` — duplicated rather than imported to
 * avoid a circular dependency (`permissions.ts` needs `gateBashCommand` from
 * this module; this module would otherwise need `isPathWithinVault` back from
 * `permissions.ts`). Keep any future change to the containment semantics in
 * sync between the two.
 */
function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isOwnWorktreeOrSharedRepo(
  targetPath: string,
  threadId: string,
  writeEnabled: boolean,
  scopeRoot?: string,
  attachmentRoot?: string,
): boolean {
  if (isPathWithinRoot(targetPath, scopeRoot ?? repoRoot())) return true;
  if (attachmentRoot !== undefined && isPathWithinRoot(targetPath, attachmentRoot)) return true;
  if (writeEnabled && isSafeThreadId(threadId) && isPathWithinRoot(targetPath, worktreePath(threadId))) {
    return true;
  }
  return false;
}

/**
 * Decide a Bash call. `threadId` is the calling session's live worktree id
 * (`AgentSession.effectiveThreadId`, the same value `KbWriteContext.getThreadId()`
 * reads from) — every path-scoped Tier-1 pattern is resolved against the
 * shared repo or THIS thread's own worktree, never another thread's.
 *
 * `skillSlugs` is the same per-clearance set `gateAgentTool` hands the `Skill`
 * gate. It scopes spec 34's carve-out below to the caller's own skills; a caller
 * that passes none keeps today's pre-spec-34 behavior for every command.
 */
export function gateBashCommand(
  input: BashInputLike,
  threadId: string,
  writeEnabled: boolean,
  scopeRoot?: string,
  skillSlugs?: ReadonlySet<string>,
  attachmentRoot?: string,
): BashVerdict {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) return "deny";
  // Spec 34's skill-script carve-out. ORDERING CONTRACT: this runs BEFORE
  // `isHardDenied` because Tier 0's INTERPRETER rule would otherwise swallow
  // every skill script. `isSkillScriptInvocation` therefore re-applies every
  // OTHER Tier 0 rule itself, so INTERPRETER is the only rule relaxed, and only
  // for a script whose real path is inside a skill THIS caller's clearance
  // materialized. The verdict is "confirm", never "allow": a human still
  // approves each run.
  if (!input.dangerouslyDisableSandbox && isSkillScriptInvocation(command, skillSlugs)) return "confirm";
  if (isHardDenied(command, input.dangerouslyDisableSandbox === true)) return "deny";

  const match = READONLY_GIT.exec(command);
  if (match && isOwnWorktreeOrSharedRepo(match[1], threadId, writeEnabled, scopeRoot, attachmentRoot)) {
    return "allow";
  }
  if (scopeRoot) return "deny";
  return "confirm";
}

/** Denial-reason text for a hard-denied `Bash` call, mirroring `denialReason`'s shape/purpose in ./permissions. */
export function bashDenialReason(input: BashInputLike): string {
  if (input.dangerouslyDisableSandbox === true) {
    return "This assistant refuses to run `Bash` with its sandbox disabled.";
  }
  const command = typeof input.command === "string" ? input.command : "";
  return (
    `This assistant only auto-runs \`Bash\` for a narrow, read-only set of git ` +
    `commands (log / diff / show / status / branch) scoped to its own ` +
    `workspace, and refuses outright — with no confirmation possible — any ` +
    `command that looks like it could read secrets/environment variables, ` +
    `reach the network, mutate or delete files, escalate privileges, or chain ` +
    `into another command. \`${command}\` matched one of those categories.`
  );
}
