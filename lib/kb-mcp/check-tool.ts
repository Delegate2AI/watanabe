import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getGitHost } from "@/lib/git-host";
import { diff as repoDiff } from "@/lib/repo-write";
import { runIntegrityChecker, type AdvisoryFinding } from "@/lib/quality/agents";
import { isIntegrityEnabled } from "@/lib/quality/config";
import { textResult } from "./paths";
import type { KbWriteContext } from "./write-tools";

/**
 * `kb_check`: run the integrity-checker over what is staged, and report what it
 * found, without committing anything.
 *
 * `kb_submit` runs the same check, but only after the branch is pushed and the
 * merge request is open, which is too late for a contributor who would rather
 * revise than propose. Its own module because `write-tools.ts` is at the
 * file-size limit, same reason as `move-tool.ts`.
 */

/**
 * The integrity findings for one diff, or none when the deployment has the
 * check turned off. Never throws: `runIntegrityChecker` degrades to an empty
 * list on any agent failure, and this adds no path of its own.
 *
 * Deliberately does NOT skip an empty diff, so `kb_submit` keeps calling the
 * checker on exactly what it called it on before. `kb_check` handles the
 * nothing-staged case itself, where it is a distinct answer rather than a
 * clean one.
 */
export async function integrityFindingsFor(diff: string, scopeRoot?: string): Promise<AdvisoryFinding[]> {
  if (!isIntegrityEnabled()) return [];
  return runIntegrityChecker(diff, scopeRoot);
}

/** One finding per line, severity first, for a tool result a model reads back to a person. */
export function formatFindings(findings: AdvisoryFinding[]): string {
  return findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n");
}

export function createCheckTool(context: KbWriteContext): SdkMcpToolDefinition<Record<string, never>> {
  return tool(
    "kb_check",
    "Check the changes staged so far against the rest of the knowledge base for duplicated or " +
      "contradicting content, WITHOUT submitting anything. ALWAYS run this after kb_diff and before " +
      "kb_submit, and read any findings back to the contributor so they can decide whether to revise " +
      "the edit or to propose it anyway. A finding is advisory, not a refusal.",
    {},
    async (): Promise<CallToolResult> => {
      const staged = await repoDiff(context.getThreadId());
      if (staged.trim() === "") {
        return textResult("(nothing staged yet, so there is nothing to check)");
      }
      if (!isIntegrityEnabled()) {
        return textResult("The knowledge base integrity check is not enabled on this deployment.");
      }
      const findings = await integrityFindingsFor(staged, context.scopeRoot);
      if (findings.length === 0) {
        return textResult("No duplicate or contradicting content found in the knowledge base.");
      }
      return textResult(
        `The integrity check found ${findings.length} thing${findings.length === 1 ? "" : "s"} to look at ` +
          `before proposing this edit:\n${formatFindings(findings)}\n\n` +
          "Show these to the contributor and ask how they want to proceed. Submitting anyway is allowed: " +
          `a flagged submission is routed through the ${getGitHost().terms.long} path for a second person to review.`,
      );
    },
  );
}
