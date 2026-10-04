/**
 * Gathers advisory quality findings for a thread's FULL staged diff, for
 * attachment to the `kb_submit` confirm request (spec 12, subsystem B4). Runs
 * both the judgment agents (`reviewStagedDiff`, subsystem B3: citation-checker
 * and style-reviewer) and a mechanical re-scan of the same diff's added lines
 * (`checkAddedLines`, subsystem B2, the same rule set `kb_stage_edit` already
 * hard-blocks on per-file), tagging the re-scan's hits as `deliverable-check`
 * so the confirm modal can tell them apart from the judgment agents' output.
 *
 * The re-scan exists because `kb_stage_edit`'s per-file gate only ever sees
 * one file's added lines at a time; this whole-diff pass is a second look
 * across everything staged, advisory only (kb_submit is not blocked by it).
 *
 * Advisory only: this function NEVER throws. A disabled flag, a diff fetch
 * that fails, an empty diff, or a judgment-agent failure (already swallowed
 * inside `reviewStagedDiff` itself) all fall through to `[]`.
 */
import { diff as repoDiff } from "@/lib/repo-write";
import { log } from "@/lib/log";
import { reviewStagedDiff, type AdvisoryFinding } from "./agents";
import { isQualityGatesEnabled } from "./config";
import { addedLinesFromDiff, checkAddedLines } from "./mechanical";

/** The mechanical re-scan (B4): `checkAddedLines` over the whole staged diff's added lines, mapped to `deliverable-check` findings. */
function mechanicalFindings(unifiedDiff: string): AdvisoryFinding[] {
  const added = addedLinesFromDiff(unifiedDiff);
  const violations = checkAddedLines(added.map((l) => l.text));
  return violations.map((v) => ({
    agent: "deliverable-check" as const,
    severity: "warn" as const,
    message: `[${v.kind}] ${v.message} ("${v.excerpt}")`,
  }));
}

export async function gatherAdvisoryFindings(threadId: string, scopeRoot?: string): Promise<AdvisoryFinding[]> {
  if (!isQualityGatesEnabled()) return [];
  try {
    const unifiedDiff = await repoDiff(threadId);
    if (!unifiedDiff.trim()) return [];
    const agentFindings = await reviewStagedDiff(unifiedDiff, scopeRoot, threadId);
    return [...mechanicalFindings(unifiedDiff), ...agentFindings];
  } catch (err) {
    log.error("[quality] gatherAdvisoryFindings failed", { threadId, err: String(err) });
    return [];
  }
}
