import { subjectPrefix } from "@/lib/config/subject";
/**
 * The headless job runner's "integration skill" — the system-prompt append
 * that turns a bare Read/Glob/Grep/TodoWrite + kb-write-tools session into an
 * agent that merges one uploaded update package into the vault. Content per
 * docs/superpowers/specs/2026-07-09-update-package-ingestion-design.md § 3.
 * "Skill file -> prompt module" is deviation #1 there: `settingSources: []`
 * means no on-disk skill file auto-loads, so this lives in code instead of a
 * `skills/integrate-update-package/SKILL.md` file.
 *
 * The hard contract this prompt exists to establish: the agent's FINAL
 * message must be the complete markdown integration report, and nothing
 * else — the runner (not the model) submits the change, and passes that
 * final message verbatim as the Merge Request description (see
 * `lib/packages/options.ts` and the design doc's job-runner section).
 */

import { getGitHost } from "@/lib/git-host";
import { titleCaseTerm } from "@/lib/git-host/terms";

function orient(): string {
  return [
    "ORIENT",
    "- Look for PACKAGE_CONTENTS.md, a MANIFEST file (e.g. 04_MANIFEST_*.md), and",
    "  a read-me (e.g. 00_READ-ME-FIRST_*.md) at the top of the package",
    "  directory. All three are optional: read whichever exist before anything",
    "  else in the package. When a manifest exists, its supersession map and",
    "  fact-class ownership (SSOT) table drive the placement decisions below.",
    "  When none exist, work from the package's actual content instead: read",
    "  every file before deciding where it belongs.",
    "- Then read the vault's own INDEX.md and CLAUDE.md at the vault root, so",
    "  placement decisions respect the vault's existing structure and",
    "  conventions instead of guessing at them.",
  ].join("\n");
}

function placement(): string {
  return [
    "PLACEMENT",
    "- Deliverables map into the vault's topical sections: 00-overview through",
    "  09-finance, plus 99-reference for reference and handoff material.",
    "- When the package supersedes an existing page (per the manifest, or",
    "  obvious content overlap when there is no manifest), update that page IN",
    "  PLACE. Add a back-link to the archived original (see ARCHIVE below)",
    "  instead of silently duplicating or orphaning the old content.",
    "- When no home exists yet, create a new page following that section's",
    "  existing naming conventions.",
    "- Respect the vault's single-source-of-truth principle: one canonical home",
    "  per fact-class. Every other page touching the same fact links to that",
    "  canonical home instead of restating it.",
  ].join("\n");
}

function archive(archiveRelPath: string): string {
  return [
    "ARCHIVE",
    `- The complete package has ALREADY been copied verbatim to`,
    `  ${archiveRelPath} before this session started. Never re-stage it`,
    "  yourself, and never call kb_stage_edit or kb_stage_delete against",
    "  anything under that path: it is already in place. Its brain files",
    "  (read-me, prompts, flags register, continuity pack) are processing",
    "  context and provenance only, never merged into a topical section.",
    `- Link topical pages you create or update back to ${archiveRelPath} as`,
    "  the source of the change.",
  ].join("\n");
}

function linkAndIndex(): string {
  return [
    "LINK & INDEX",
    "- Update INDEX.md and every cross-link affected by a page you created,",
    "  updated, or superseded, so the vault's navigation stays accurate.",
  ].join("\n");
}

function writingDiscipline(): string {
  return [
    "WRITING DISCIPLINE",
    "- Any prose you author must pass this vault's mechanical writing gates:",
    "  no em dashes (use commas, colons, parentheses, or vs./or/to instead),",
    "  and no unsourced figures (cite a source file for any number, or label",
    "  it an estimate).",
    "- The package's own prose will often violate these (source material is",
    "  not held to this vault's style). Rewrite it into compliant prose when",
    "  you place it: never quote a violating passage raw just because it is",
    "  quicker.",
  ].join("\n");
}

function reportContract(changeRequest: string): string {
  return [
    "FINAL MESSAGE = THE INTEGRATION REPORT",
    "- Nobody is watching this session live, so there is no one to ask a",
    "  clarifying question of. Make the best defensible call yourself, note it",
    "  as a judgment call in your report, and keep going.",
    "- Your FINAL message in this session must be the complete markdown",
    "  integration report, and nothing else. It is used verbatim as the",
    `  ${changeRequest} description, so write it as a standalone document a`,
    "  reviewer can read with no other context.",
    "- Structure:",
    "  1. Placement table: package file, vault path, and one of",
    "     created / updated / superseded / archived-only.",
    "  2. Supersessions applied, and the manifest rows (or content evidence)",
    "     that mandated each one.",
    "  3. Judgment calls: every placement or wording decision you made",
    "     without manifest backing.",
    "  4. Unresolved conflicts or ambiguities you could not resolve yourself,",
    `     for the reviewer to settle on the ${changeRequest}.`,
    "  5. Files skipped, and why.",
  ].join("\n");
}

/**
 * Build the prompt append for one package's integration job.
 *
 * @param packageName the package's display name, used both to introduce the
 *   job and (by the caller, `lib/packages/options.ts`) to derive the archive
 *   path this prompt references.
 * @param packageDirAbs absolute path to the package's normalized files, added
 *   to this session's readable roots by `lib/packages/gate.ts`.
 * @param archiveRelPath vault-relative path (e.g.
 *   `99-reference/handoffs/<NAME>/`) where the runner pre-copied the package
 *   verbatim before this session started.
 */
export function buildPackagesPrompt(p: {
  packageName: string;
  packageDirAbs: string;
  archiveRelPath: string;
}): string {
  const intro = [
    `You are running a headless, unattended job: integrating the uploaded`,
    `update package "${p.packageName}" into the ${subjectPrefix()}knowledge-base`,
    `vault.`,
    "",
    `The package's normalized files live at: ${p.packageDirAbs}`,
    "Your current working directory is your own git worktree's vault root.",
  ].join("\n");

  return [intro, orient(), placement(), archive(p.archiveRelPath), linkAndIndex(), writingDiscipline(), reportContract(titleCaseTerm(getGitHost().terms))].join(
    "\n\n",
  );
}
