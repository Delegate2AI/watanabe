import { readdirSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { unfilteredVaultRoot, vaultRootFor } from "@/lib/repo";
import { ensureWorktree, worktreeVaultRoot } from "@/lib/repo-write";
import { planMove } from "./move";
import { errorResult, textResult } from "./paths";
import type { KbWriteContext } from "./write-tools";

/**
 * `kb_stage_move` (spec 2026-08-21-admin-kb-mcp, D6). Its own module because it
 * is the one staging tool that needs an algorithm rather than a wrapper, and
 * `write-tools.ts` is at the file-size limit.
 */

function markdownCount(root: string, dir: string = root): number {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(/* turbopackIgnore: true */ dir, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) total += markdownCount(root, path.join(dir, entry.name));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) total += 1;
  }
  return total;
}

/**
 * Whether this person's projection is the whole vault.
 *
 * A link rewrite scoped to a partial projection cannot see the links it is
 * breaking, so a partial rewrite is worse than a refusal. Fails closed: an
 * unreadable root counts as not seeing everything.
 */
export function seesWholeVault(ownerEmail: string): boolean {
  try {
    const full = unfilteredVaultRoot();
    const mine = vaultRootFor(resolveClearance(ownerEmail, loadGroups()));
    if (path.resolve(mine) === path.resolve(full)) return true;
    return markdownCount(mine) === markdownCount(full);
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the SDK's own tool-definition signature.
export function createMoveTool(context: KbWriteContext): SdkMcpToolDefinition<any> {
  return tool(
    "kb_stage_move",
    "Move or rename a file or folder in the knowledge-base vault, rewriting every link that " +
      "points at it so nothing is left dangling. Staged in your own private workspace; run " +
      "kb_diff to review the rename AND the rewrites before submitting.",
    {
      from: z.string().describe('The current path, relative to the vault root, e.g. "04-economy/old.md".'),
      to: z.string().describe('The new path, relative to the vault root, e.g. "05-treasury/new.md".'),
    },
    async (args): Promise<CallToolResult> => {
      if (!seesWholeVault(context.ownerEmail)) {
        return errorResult(
          "Moving a file rewrites links across the whole knowledge base, and your clearance does not cover " +
            "all of it. Ask an admin to make this move.",
        );
      }

      const threadId = context.getThreadId();
      await ensureWorktree(threadId);
      const root = worktreeVaultRoot(threadId);
      const plan = planMove(root, args.from, args.to);
      if ("error" in plan) return errorResult(plan.error);

      // One rename, so a directory takes its non-markdown files with it.
      const target = path.join(root, plan.directory.to);
      // turbopackIgnore: runtime worktree paths, as in write-tools.ts.
      await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
      await rename(/* turbopackIgnore: true */ path.join(root, plan.directory.from), target);
      for (const rewrite of plan.rewrites) {
        await writeFile(/* turbopackIgnore: true */ path.join(root, rewrite.path), rewrite.content, "utf8");
      }

      const files = plan.rewrites.length === 1 ? "1 file" : `${plan.rewrites.length} files`;
      return textResult(
        `Staged move of "${args.from}" to "${args.to}" (${plan.renames.length} file(s)), rewriting links in ` +
          `${files}. Run kb_diff to review before submitting.`,
      );
    },
  );
}
