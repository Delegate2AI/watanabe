import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { refreshRepo } from "@/lib/repo";
import {
  diffFile as repoDiffFile,
  discard as repoDiscard,
  diff as repoDiff,
  ensureWorktree,
  restoreFile as repoRestoreFile,
  submit as repoSubmit,
  worktreeVaultRoot,
} from "@/lib/repo-write";
import { getGitHost } from "@/lib/git-host";
import { titleCaseTerm } from "@/lib/git-host/terms";
import { splitMergeRequestTitle } from "@/lib/git-host/title";
import { sanitizeMrDescription } from "@/lib/packages/mr-description";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { committedIndexIsStale, rebuildIndex } from "@/lib/index/cache";
import { clearKbGraphCache } from "@/lib/kb/graph-cache";
import { isIndexEnabled } from "@/lib/index/config";
import { addedLinesFromDiff, checkAddedLines } from "@/lib/quality/mechanical";
import { isQualityGatesEnabled } from "@/lib/quality/config";
import { can } from "@/lib/authority/roles";
import { KNOWN_BINARY_EXTENSIONS, errorResult, resolveWritableInRoot, textResult } from "./tools";
import { createCheckTool, formatFindings, integrityFindingsFor } from "./check-tool";
import { createMoveTool } from "./move-tool";
import { subjectPrefix } from "@/lib/config/subject";

/**
 * The write/staging tools this portal's `kb` MCP server carries ONLY
 * when `isKbWriteEnabled()` (see `lib/agent/permissions.ts` and
 * `lib/kb-mcp/server.ts`'s conditional registration). Thin wrappers only:
 * Zod schemas + input validation live here; all git/filesystem work is
 * `lib/repo-write.ts`'s (the worktree lifecycle) or `lib/gitlab.ts`'s (the MR
 * API call) — this module never shells out to `git` itself.
 *
 * Every handler resolves its target path with `resolveWritableInRoot` against the
 * THREAD'S OWN worktree vault root (`worktreeVaultRoot`), not the read
 * path's `vaultRoot()` — the same containment + ignore-list check, applied
 * to a different root, so a write tool can never escape its own worktree any
 * more than a read tool can escape the live vault.
 */

/**
 * What the write tools need from the `AgentSession` that owns them: the
 * current worktree/thread identity and the identity used for commit
 * attribution. `getThreadId()` is a live getter, not a captured value —
 * see `AgentSession.effectiveThreadId`'s doc comment for why (a brand-new
 * session's real SDK id isn't known until its first message completes).
 */
export interface KbWriteContext {
  getThreadId(): string;
  ownerEmail: string;
  ownerName?: string;
  scopeRoot?: string;
  /**
   * Refuse `KB_WRITE_MODE=direct` for this context. The remote MCP surface sets
   * it: a client is less observed than the chat UI, so the diff is the only
   * artifact a second person can review, and it always gets one.
   */
  forceMergeRequest?: boolean;
}

/** `KB_WRITE_MODE` — `"mr"` (default) opens a Merge Request; `"direct"` pushes straight to `main`. See spec 10 D10. */
function writeMode(context: KbWriteContext): "mr" | "direct" {
  if (context.forceMergeRequest) return "mr";
  return process.env.KB_WRITE_MODE?.trim().toLowerCase() === "direct" ? "direct" : "mr";
}

/** The GitLab Project Access Token used only inside `kb_submit`'s push/MR call — never logged, never returned to the model. */
function writeToken(): string | null {
  const t = process.env.REPO_WRITE_TOKEN?.trim();
  return t && t.length > 0 ? t : null;
}

/** Only safe characters for a git branch-name segment — the model's raw slug is never trusted unsanitized. */
const SAFE_SLUG = /^[a-z0-9-]+$/;

/** File extensions this write path refuses to write — mirrors `kb_read`'s binary rejection (this is a plain-text vault, not a binary asset store). */
function isBinaryPath(relPath: string): boolean {
  return KNOWN_BINARY_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

/**
 * `kb_stage_edit`'s mechanical quality gate (spec 12 B2), gated on
 * `isQualityGatesEnabled()` at the call site below. Diffs the just-written
 * `absPath` against its last committed (HEAD) content via `repoDiffFile`,
 * runs `checkAddedLines` on ONLY the added lines, and returns a formatted
 * violation message, or `null` when clean. Diff-scoped on purpose: a legacy
 * paragraph elsewhere in the same file (e.g. one with a pre-existing em
 * dash) never blocks an edit that doesn't touch it.
 */
async function mechanicalViolationMessage(threadId: string, relPath: string, absPath: string): Promise<string | null> {
  const unifiedDiff = await repoDiffFile(threadId, absPath);
  const added = addedLinesFromDiff(unifiedDiff);
  const violations = checkAddedLines(added.map((l) => l.text));
  if (violations.length === 0) return null;

  const lines = violations.map((v) => {
    const fileLine = added[v.line - 1]?.line;
    const where = fileLine ? `line ${fileLine}` : `added line ${v.line}`;
    return `- [${v.kind}] ${where}: ${v.message} ("${v.excerpt}")`;
  });
  return (
    `Can't stage "${relPath}": the lines you added trip the knowledge base's mechanical writing checks:\n${lines.join("\n")}\n\n` +
    "Fix these and call kb_stage_edit again."
  );
}

/**
 * Appended to `kb_submit`'s success text when the index subsystem is enabled
 * AND a committed `INDEX.md` no longer matches a fresh rebuild (spec 10 A5).
 * Empty when `isIndexEnabled()` is off, so a disabled index leaves the
 * success text byte-identical to before this note existed.
 */
function staleIndexNote(): string {
  return isIndexEnabled() && committedIndexIsStale()
    ? "\n\nNote: the committed INDEX.md is now stale; ask me to regenerate it."
    : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the SDK's own `createSdkMcpServer({ tools: Array<SdkMcpToolDefinition<any>> })` signature.
export function createWriteTools(context: KbWriteContext): SdkMcpToolDefinition<any>[] {
  const changeRequest = titleCaseTerm(getGitHost().terms);
  return [
    tool(
      "kb_stage_edit",
      "Create or overwrite one file in the knowledge-base vault with the given full text " +
        "content, inside your OWN private staging workspace — nothing is visible to anyone " +
        "else, and nothing is committed, until kb_submit is confirmed. Overwrites the whole " +
        "file; to make a partial change, read the file first (kb_read) and pass back the " +
        "full new content.",
      {
        path: z.string().describe('File path relative to the vault root, e.g. "04-economy/tokenomics.md".'),
        new_content: z.string().describe("The complete new contents of the file."),
      },
      async (args): Promise<CallToolResult> => {
        if (isBinaryPath(args.path)) {
          return errorResult(`"${args.path}" looks like a binary file — this vault only accepts text edits.`);
        }
        const threadId = context.getThreadId();
        await ensureWorktree(threadId);
        const resolved = resolveWritableInRoot(args.path, worktreeVaultRoot(threadId));
        if (!resolved.ok) return resolved.result;

        const gatesEnabled = isQualityGatesEnabled();
        // Snapshot the worktree file's PRE-this-call content, so a rejected
        // edit below can be undone back to what was there a moment ago
        // (which may be an earlier, still-valid staged edit in this same
        // thread) rather than blown all the way back to HEAD. Only taken on
        // the gated path: the flag-off path never captures it and never
        // touches git, so it stays byte-identical to before this snapshot
        // existed.
        const priorContent = gatesEnabled ? await readFile(resolved.abs, "utf8").catch(() => null) : null;

        // turbopackIgnore: `resolved.abs` is a runtime-computed worktree
        // path, not a project file — same rationale as lib/repo-write.ts's
        // dynamic fs calls.
        await mkdir(/* turbopackIgnore: true */ path.dirname(resolved.abs), { recursive: true });
        await writeFile(/* turbopackIgnore: true */ resolved.abs, args.new_content, "utf8");

        if (gatesEnabled) {
          const violationMessage = await mechanicalViolationMessage(threadId, args.path, resolved.abs);
          if (violationMessage) {
            await repoRestoreFile(threadId, resolved.abs, priorContent);
            return errorResult(violationMessage);
          }
        }

        return textResult(`Staged edit to "${args.path}". Run kb_diff to review before submitting.`);
      },
    ),
    tool(
      "kb_stage_delete",
      "Delete one file from the knowledge-base vault, inside your own private staging " +
        "workspace — nothing is committed until kb_submit is confirmed.",
      {
        path: z.string().describe('File path relative to the vault root, e.g. "04-economy/old-page.md".'),
      },
      async (args): Promise<CallToolResult> => {
        const threadId = context.getThreadId();
        await ensureWorktree(threadId);
        const resolved = resolveWritableInRoot(args.path, worktreeVaultRoot(threadId));
        if (!resolved.ok) return resolved.result;
        try {
          // turbopackIgnore: same rationale as kb_stage_edit above.
          await unlink(/* turbopackIgnore: true */ resolved.abs);
        } catch {
          return errorResult(`No such file in the knowledge base: "${args.path}".`);
        }
        return textResult(`Staged deletion of "${args.path}". Run kb_diff to review before submitting.`);
      },
    ),
    tool(
      "kb_diff",
      "Show the unified diff of every change staged so far in your private workspace " +
        "(kb_stage_edit / kb_stage_delete calls). ALWAYS run this and show the contributor " +
        "the diff before proposing kb_submit.",
      {},
      async (): Promise<CallToolResult> => {
        const threadId = context.getThreadId();
        const result = await repoDiff(threadId);
        return result.trim() === "" ? textResult("(nothing staged yet)") : textResult(result);
      },
    ),
    createCheckTool(context),
    createMoveTool(context),
    tool(
      "kb_discard",
      "Discard everything staged so far in your private workspace, without committing " +
        "anything. Use this if the contributor changes their mind about a proposed edit.",
      {},
      async (): Promise<CallToolResult> => {
        await repoDiscard(context.getThreadId());
        return textResult("Discarded all staged changes.");
      },
    ),
    tool(
      "kb_submit",
      `Commit the staged changes and either open a ${changeRequest} or push directly to main ` +
        "(deployment-configured), attributed to the contributor. Requires the contributor's " +
        "own confirmation in the chat UI first — never call this without them having " +
        "explicitly asked you to submit/commit the change they just reviewed via kb_diff " +
        "and kb_check.",
      {
        message: z.string().min(1).describe("The commit message summarizing this change."),
        slug: z
          .string()
          .min(1)
          .describe('A short, url-safe slug for the branch name, e.g. "add-trader-score-section" (lowercase letters, digits, hyphens only).'),
      },
      async (args): Promise<CallToolResult> => {
        if (!SAFE_SLUG.test(args.slug)) {
          return errorResult(
            `"${args.slug}" isn't a valid slug — use only lowercase letters, digits, and hyphens.`,
          );
        }
        const mode = writeMode(context);
        const requiredCapability = mode === "direct" ? "approve" : "write";
        if (!can(context.ownerEmail, requiredCapability)) {
          const requiredRole = mode === "direct" ? "approver" : "editor";
          return errorResult(
            `Permission denied: ${mode} submission requires the ${requiredRole} role or higher.`,
          );
        }
        const token = writeToken();
        if (!token) {
          return errorResult("Write mode is misconfigured on this deployment (no write credential) — cannot submit.");
        }
        const threadId = context.getThreadId();
        // Escalation: a flagged integrity finding forces THIS submission
        // through the reviewable MR path, even on a deployment configured
        // for direct-to-main. Computed AFTER the capability gate above,
        // which stays keyed on the deployment's real mode: escalation may
        // only make an already-permitted submission more reviewable, never
        // grant a new submitter access.
        const integrityFindings = await integrityFindingsFor(await repoDiff(threadId), context.scopeRoot);
        const effectiveMode = integrityFindings.length > 0 ? "mr" : mode;
        const result = await repoSubmit(threadId, {
          message: args.message,
          slug: args.slug,
          authorName: context.ownerName ?? context.ownerEmail,
          authorEmail: context.ownerEmail,
          mode: effectiveMode,
          writeToken: token,
        });

        if (!result.ok) {
          // `conflict` is only present (always `true`) on the conflict variant of
          // SubmitResult — checking presence alone narrows cleanly, unlike
          // `"conflict" in result && result.conflict` (TS doesn't reliably narrow
          // the fallthrough after a compound `&&` condition like that).
          if ("conflict" in result) {
            return errorResult(
              `This edit conflicts with a more recent change to the knowledge base in: ${result.files.join(", ")}. ` +
                `The staged edit is preserved — ask the contributor how they'd like to resolve it.`,
            );
          }
          return errorResult(`Could not submit: ${result.error}`);
        }

        if (effectiveMode === "direct") {
          await refreshRepo(); // fast-forward the read-serving checkout so the view reflects this immediately (spec 10 D13)
          if (isIndexEnabled()) {
            rebuildIndex(); // the read checkout above now has the new content, so the index reflects it too
          }
          clearKbGraphCache(); // and so do the link graph and the backlink map, which are cached on a TTL
          return textResult(`Committed directly to main.${staleIndexNote()}`);
        }

        try {
          const text = splitMergeRequestTitle(
            args.message,
            `Proposed via the ${subjectPrefix()}KB chat assistant by ${context.ownerName ?? context.ownerEmail}.`,
          );
          const mr = await getGitHost().createChangeRequest({
            sourceBranch: result.branch,
            title: text.title,
            // Sanitized because the description now carries the contributor's
            // own commit body, which could otherwise open with a quick action.
            description: sanitizeMrDescription(text.description),
            token,
          });
          captureServerEvent("kb_edit_proposed", {
            distinctId: analyticsIdFor(context.ownerEmail),
            properties: { origin: "chat", flagged: integrityFindings.length > 0 },
          });
          // The findings themselves, not just that there were some: this text is
          // the only place the contributor's own client ever sees them.
          const escalationNote =
            integrityFindings.length > 0
              ? `\n\nThis was flagged for review, because the integrity check found possible duplicate or ` +
                `contradicting content. Show the contributor what it found:\n${formatFindings(integrityFindings)}`
              : "";
          return textResult(`${changeRequest} opened: ${mr.webUrl}${escalationNote}${staleIndexNote()}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(
            `Pushed branch "${result.branch}" successfully, but opening the ${changeRequest} failed: ${message}. ` +
              `The branch is on the remote, so a ${changeRequest} can still be opened manually.`,
          );
        }
      },
    ),
  ];
}
