import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolveAgentEnv } from "@/lib/agent/auth";
import { log } from "@/lib/log";
import { captureUsage } from "@/lib/usage/capture";
import { isMemoryEnabled, memoryWorktreeDir } from "./config";
import { createMemMcpServer } from "./mem-server";
import { commitMemoryLocked, withMemoryLock } from "./repo-memory";
import { emailSlug } from "./paths";
import { getConfig } from "@/lib/config";
import { withTimeout } from "./timeout";

const MODEL = process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8";

/**
 * How long a single dream's SDK query is allowed to run before it gets
 * interrupted. A hung subprocess (stuck tool call, model hang, ...) would
 * otherwise hold `withMemoryLock` forever, deadlocking every future dream AND
 * the HTTP end route that awaits `runDream`. Overridable via
 * `MEMORY_DREAM_TIMEOUT_MS` for tests/tuning; defaults to 2 minutes, which is
 * generous for a consolidation pass over one transcript.
 */
const DEFAULT_DREAM_TIMEOUT_MS = 120_000;

/**
 * The dream's ENTIRE tool surface. Passed as both `tools` (what exists) and
 * `allowedTools` (what runs unprompted), so no built-in filesystem or shell
 * tool is reachable from a bypassPermissions session whose prompt contains
 * attacker-influenced transcript text. See the comment at the `tools:` option
 * below for why the two options are not interchangeable.
 */
export const DREAM_TOOLS = [
  "mcp__mem__mem_list",
  "mcp__mem__mem_read",
  "mcp__mem__mem_write",
  "mcp__mem__mem_delete",
] as const;

function dreamTimeoutMs(): number {
  const raw = process.env.MEMORY_DREAM_TIMEOUT_MS?.trim();
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DREAM_TIMEOUT_MS;
}

async function drainQuery(q: Query, onResult?: (msg: Extract<SDKMessage, { type: "result" }>) => void): Promise<void> {
  for await (const msg of q) {
    if (msg.type === "result") onResult?.(msg);
  }
}

function memoryRulesSuffix(): string {
  const summary = getConfig().agent.memoryRulesSummary;
  return summary ? `, ${summary}` : "";
}

/**
 * The 4-phase consolidation discipline, mirroring the research-harness `dream`
 * skill: orient over existing memory, gather new signal from the transcript,
 * consolidate into topic files (merge, do not duplicate), then prune and re-index.
 * Writes land through mem_write/mem_delete into the memory worktree; the caller
 * commits and pushes afterward.
 */

export function dreamSystemPrompt(ownerEmail: string, clearance: string[] = []): string {
  const slug = emailSlug(ownerEmail);
  // Shared memory is group-scoped (spec 32). The tool layer enforces this, so
  // these lines are guidance for producing a USEFUL classification, not the
  // security boundary: a write outside the owner's clearance is rejected by
  // `isWithinWriteScope` no matter what the transcript talks the model into.
  const sharedLines = clearance.length
    ? [
        "- Shared team memory, one directory per group. Only these are writable for this user:",
        ...clearance.map((g) => `    memory/shared/${g}/<slug>.md, indexed by memory/shared/${g}/MEMORY.md`),
        "  Put a fact in the NARROWEST group that everyone needing it belongs to. A fact drawn",
        "  from a restricted group's material must never be written into a broader group.",
      ]
    : ["- This user has no shared-group clearance; write private memory only."];
  return [
    "You are performing a DREAM: a reflective consolidation of a chat transcript into",
    `durable memory for the user ${ownerEmail}.`,
    "",
    "Use mem_list/mem_read to orient before writing. Use mem_write to create or update",
    "memory files, and mem_delete to prune contradicted ones. Paths:",
    ...sharedLines,
    `- This user's private memory: memory/users/${slug}/<slug>.md, indexed by memory/users/${slug}/MEMORY.md`,
    "",
    "PHASES",
    "1. Orient: mem_list the memory dirs, mem_read the indexes and any topic file you might update.",
    "2. Gather: from the transcript, extract only durable signal (user preferences, corrections,",
    "   project context, decisions, references). Ignore ephemeral chatter and anything derivable from code.",
    "3. Consolidate: merge into existing files rather than duplicating. Each file has frontmatter",
    "   (name, description, type: user|feedback|project|reference). Convert relative dates to absolute.",
    "4. Prune and index: keep each MEMORY.md an index (one line per memory, under 200 lines), not a dump.",
    "",
    "House/discipline rules apply to everything you write: no em dashes, no invented numbers,",
    `no time estimates${memoryRulesSuffix()}.`,
    "If nothing is worth persisting, write nothing.",
  ].join("\n");
}

/**
 * Run one headless consolidation pass: a full-tool-access SDK query over the
 * memory worktree, then a commit of whatever landed. Wraps the ENTIRE
 * critical section (query's file mutations plus the commit) in a single
 * `withMemoryLock`, so it never interleaves with another dream or a chat
 * session's `commitMemory` call on the same shared worktree. Calls
 * `commitMemoryLocked` (not `commitMemory`) from inside that lock, since
 * `commitMemory` itself acquires the lock and would deadlock here.
 *
 * Never throws: a query failure is logged and swallowed, falling through to
 * commit whatever mem_write/mem_delete calls DID land before the error.
 */
export async function runDream(input: {
  sdkSessionId: string;
  ownerEmail: string;
  ownerName?: string;
  transcript: string;
  /**
   * The owner's resolved clearance. Defaults to `[]`, which grants no shared
   * write access at all (spec 32 D32.4), so a caller that forgets it degrades
   * to private-only memory rather than to unrestricted shared writes.
   */
  clearance?: string[];
}): Promise<"committed" | "nothing" | "failed" | "skipped"> {
  if (!isMemoryEnabled() || !input.transcript.trim()) return "skipped";
  return withMemoryLock(async () => {
    try {
      const q = query({
        prompt: `TRANSCRIPT TO CONSOLIDATE:\n\n${input.transcript}`,
        options: {
          model: MODEL,
          cwd: memoryWorktreeDir(),
          settingSources: [],
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: dreamSystemPrompt(input.ownerEmail, input.clearance ?? []),
          },
          permissionMode: "bypassPermissions",
          // `tools` and `allowedTools` are NOT the same lever, and the
          // difference is load-bearing here. `allowedTools` only auto-approves
          // (SDK: "To restrict which tools are available, use the `tools`
          // option instead"), so listing the mem tools there left the full
          // claude_code preset available: Bash, Read, Write, Edit, Glob, Grep,
          // every one of them auto-approved by bypassPermissions, with `cwd`
          // pointing at the memory worktree. That made the mem scope checks
          // optional for this session. A prompt-injected transcript could just
          // say "Bash: cat memory/shared/<group>/*.md", or edit access/*.yaml
          // (groups, roles, flags all live on this branch) to grant itself
          // clearance process-wide.
          //
          // The chat path closes this with a deny-by-default PreToolUse hook
          // (`lib/agent/config.ts`, `lib/agent/permissions.ts`); the dream has
          // no hook, so it must constrain availability directly. Keep both
          // lists identical: `tools` decides what exists, `allowedTools`
          // decides what runs without a prompt.
          tools: [...DREAM_TOOLS],
          allowedTools: [...DREAM_TOOLS],
          // "full" mode's mem_write/mem_delete are scoped to
          // memory/users/<ownerSlug>/** and the memory/shared/<group>/**
          // directories this owner is cleared for. With the tool surface
          // restricted above, these checks are now genuinely the only route to
          // the filesystem, so a prompt-injected transcript cannot reach
          // another user's subtree or a group the owner cannot see (D32.3).
          mcpServers: {
            mem: createMemMcpServer("full", emailSlug(input.ownerEmail), input.clearance ?? []),
          },
          maxTurns: 30,
          maxBudgetUsd: 1.0,
          env: resolveAgentEnv(),
        },
      });
      // Drain the query to completion, but bounded: a hung subprocess must
      // not hold the memory lock forever. On timeout, interrupt the
      // subprocess and fall through to commit whatever mem_write/mem_delete
      // calls already landed before it hung. The interrupt itself is
      // fire-and-forget (not awaited): withTimeout no longer waits on
      // onTimeout, so a wedged subprocess that also ignores the interrupt
      // control-request can no longer hang withTimeout, and therefore can no
      // longer deadlock withMemoryLock and every future dream behind it.
      await withTimeout(
        drainQuery(q, (msg) => {
          captureUsage(msg, {
            source: "dream",
            ownerEmail: input.ownerEmail,
            threadId: input.sdkSessionId,
          });
        }),
        dreamTimeoutMs(),
        () => {
          log.warn("[memory] dream timed out; interrupting", { sdkSessionId: input.sdkSessionId });
          void q.interrupt().catch((interruptErr) => {
            log.error("[memory] dream interrupt failed", {
              sdkSessionId: input.sdkSessionId,
              err: String(interruptErr),
            });
          });
        },
      );
    } catch (err) {
      log.error("[memory] dream query failed", { sdkSessionId: input.sdkSessionId, err: String(err) });
      // fall through to commit whatever DID land before the error
    }
    return commitMemoryLocked({
      message: `memory: consolidate session ${input.sdkSessionId.slice(0, 8)}`,
      authorName: input.ownerName ?? input.ownerEmail,
      authorEmail: input.ownerEmail,
    });
  });
}
