"use client";

import type { SkillOutcome } from "./skills-types";

/**
 * What an install, update, uninstall, or clearance change actually reported.
 *
 * Three of the fields are the whole reason this is a banner and not a toast.
 * `replaced` means the install overwrote a skill that was already installed
 * under that slug, which is otherwise a silent success. `warning:
 * "store_directory_remains"` means the registry row went but the files did not,
 * which nothing else in the app would ever surface. `blockedScripts` names the
 * scripts the Bash policy can never run, which is the one moment an admin can
 * still act on it. Any of the three raises the banner to `role="alert"`.
 */

/** Whether this outcome is something the admin has to act on rather than just read. */
function isLoud(outcome: SkillOutcome): boolean {
  return (
    outcome.replaced === true ||
    outcome.warning !== undefined ||
    (outcome.blockedScripts ?? []).length > 0
  );
}

/** One sentence for what happened, shared by the banner and the toast. */
export function outcomeHeadline(outcome: SkillOutcome): string {
  if (outcome.kind === "uninstall") return `${outcome.slug} was uninstalled.`;
  if (outcome.kind === "groups") return `Clearance groups saved for ${outcome.slug}.`;
  if (outcome.kind === "update") {
    return outcome.previousCommit && outcome.commit
      ? `${outcome.slug} updated from ${outcome.previousCommit} to ${outcome.commit}.`
      : `${outcome.slug} was updated.`;
  }
  return outcome.commit ? `${outcome.slug} installed at ${outcome.commit}.` : `${outcome.slug} installed.`;
}

export function OutcomeBanner({ outcome }: { outcome: SkillOutcome }) {
  const loud = isLoud(outcome);
  const blocked = outcome.blockedScripts ?? [];
  return (
    <div
      role={loud ? "alert" : "status"}
      className={`grid gap-2 rounded-xl px-4 py-3 text-sm text-pretty ${loud ? "bg-amber-500/15 text-amber-800" : "bg-surface-2 text-ink"}`}
    >
      <p>{outcomeHeadline(outcome)}</p>

      {outcome.replaced === true && (
        <p>
          This replaced a skill that was already installed as {outcome.slug}. The slug comes from the
          skill&apos;s own frontmatter, so a different repository can land on an existing one: the previous
          content has been overwritten and its registry entry now points at this source.
        </p>
      )}

      {outcome.warning === "store_directory_remains" && (
        <p>
          The registry entry is gone, but the files could not be deleted. The {outcome.slug} directory
          remains in the skill store and has to be removed by hand. Nothing loads it, because
          materialization follows the registry.
        </p>
      )}

      {blocked.length > 0 && <BlockedScripts testId="outcome-blocked-scripts" scripts={blocked} />}
    </div>
  );
}

/**
 * The scripts whose own path trips a Tier 0 bash pattern. Rendered wherever a
 * skill is shown, because the failure is otherwise invisible until a session
 * gets a flat deny with no explanation, and the fix is a rename only an admin
 * can make.
 */
export function BlockedScripts({ testId, scripts }: { testId: string; scripts: string[] }) {
  return (
    <div data-testid={testId} className="grid gap-1">
      <p className="font-medium">
        {scripts.length} script{scripts.length === 1 ? "" : "s"} can never run, whatever a session asks:
      </p>
      <ul className="list-disc pl-5">
        {scripts.map((script) => (
          <li key={script}><code className="text-xs">{script}</code></li>
        ))}
      </ul>
      <p>
        The Bash policy refuses a command whose text matches a dangerous pattern, and it re-applies those
        patterns to the whole command line for a skill script. These file paths match one on their own, so
        every invocation of them is denied. Rename the files upstream and install again.
      </p>
    </div>
  );
}

/**
 * A refusal. `text` is always mapped copy from `messageForBody`; `reason` is the
 * install pipeline's own sentence, which the route already scrubbed of absolute
 * paths and capped. It is shown because it is the only thing that says WHICH
 * repository, ref, or archive was rejected and why, and this surface is
 * admin-gated. It is rendered as text, never as markup: it can carry content
 * that came from a remote repository or a remote index.
 */
export function FailureBanner({ text, reason }: { text: string; reason?: string }) {
  return (
    <div role="alert" className="grid gap-1 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 text-pretty">
      <p>{text}</p>
      {reason && <p className="text-xs">{reason}</p>}
    </div>
  );
}
