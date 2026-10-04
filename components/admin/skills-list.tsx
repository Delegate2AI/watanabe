"use client";

import { useState } from "react";
import { buttonClass } from "./access-ui";
import { GroupPicker, knownGroups, staleGroups } from "./skills-groups";
import { BlockedScripts } from "./skills-outcome";
import type { SkillRow, SkillSourceRow } from "./skills-types";

/**
 * One installed skill as the admin list shows it: what it is, where it came
 * from and at which commit, who is cleared for it, and what the install-time
 * compatibility report found.
 *
 * The compat badges are advisory and always visible, per spec 34: scripts in
 * amber because they are a trust decision, unsupported tools in red because
 * they are a promise the skill makes that this app cannot keep. The blocked
 * scripts are separate from both, because they are not advisory at all.
 */

function chip(tone: "ok" | "warn" | "bad" | "muted"): string {
  const colors = {
    ok: "bg-emerald-500/15 text-emerald-700",
    warn: "bg-amber-500/20 text-amber-700",
    bad: "bg-red-500/15 text-red-700",
    muted: "bg-surface-2 text-ink-muted",
  };
  return `rounded-full px-2.5 py-1 text-xs font-medium ${colors[tone]}`;
}

/** Where the folder came from, in one line an admin can act on. */
function describeSource(source: SkillSourceRow): string {
  if (source.type === "zip") return `uploaded from ${source.filename}`;
  if (source.type === "authored") return `authored in the portal by ${source.author}, rev ${source.rev}`;
  const where = source.subdir ? `${source.url} (${source.subdir})` : source.url;
  if (source.type === "git") return `${where} at ${source.ref}, pinned to ${source.commit}`;
  return `${source.name} from ${source.index}, ${where}, pinned to ${source.commit}`;
}

export function SkillCard({
  row,
  groupNames,
  pending,
  onUpdate,
  onSetGroups,
  onUninstall,
}: {
  row: SkillRow;
  groupNames: string[];
  pending: boolean;
  onUpdate: () => void;
  onSetGroups: (groups: string[]) => Promise<boolean>;
  onUninstall: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const healthy = row.status === "ok";
  const scripts = row.compat?.scripts ?? [];
  const tools = row.compat?.tools ?? [];
  const updatable = healthy && row.source !== undefined && row.source.type !== "zip" && row.source.type !== "authored";

  return (
    <article className="grid gap-3 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{row.title ?? row.slug}</h3>
        <code className="text-xs text-ink-faint">{row.slug}</code>
        {healthy ? (
          <span className={chip(row.installed ? "ok" : "bad")}>{row.installed ? "installed" : "files missing"}</span>
        ) : (
          <span className={chip("warn")}>disabled</span>
        )}
        {row.source && <span className={chip("muted")}>{row.source.type}</span>}
      </div>

      {healthy ? (
        <>
          {row.source && <p className="text-xs text-ink-muted text-pretty">{describeSource(row.source)}</p>}
          <p className="text-xs text-ink-muted text-pretty">
            {row.groups && row.groups.length > 0 ? `Cleared for ${row.groups.join(", ")}` : "Cleared for nobody"}
          </p>
          <div className="flex flex-wrap gap-2">
            <span className={chip(scripts.length > 0 ? "warn" : "muted")}>scripts: {scripts.length}</span>
            <span className={chip(tools.length > 0 ? "bad" : "muted")}>unsupported tools: {tools.length}</span>
          </div>
          {tools.length > 0 && (
            <p className="text-xs text-red-700 text-pretty">
              This skill declares {tools.join(", ")}, which this app does not expose. Steps that rely on
              those tools will not work.
            </p>
          )}
          {row.blockedScripts.length > 0 && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 text-pretty">
              <BlockedScripts testId={`blocked-scripts-${row.slug}`} scripts={row.blockedScripts} />
            </div>
          )}
          {row.scriptsTruncated && (
            <p className="text-xs text-amber-700 text-pretty" data-testid={`scripts-truncated-${row.slug}`}>
              The recorded script list was shortened when this skill was installed, so the blocked-script
              check above reads a partial list and there may be more it cannot see. The report shown at
              install time was the complete one.
            </p>
          )}
          {!row.installed && (
            <p className="text-xs text-red-700 text-pretty">
              The registry lists this skill but the store holds no folder for it, so it is skipped when a
              session is built.{" "}
              {row.source?.type === "zip"
                ? "A zip install has no remote to re-fetch, so upload the archive again as a new install, or uninstall it."
                : "Update it to fetch the content again, or uninstall it."}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-amber-700 text-pretty">{row.reason}</p>
      )}

      {editing && (
        <GroupEditor
          slug={row.slug}
          groups={row.groups}
          groupNames={groupNames}
          pending={pending}
          onSave={async (groups) => {
            if (await onSetGroups(groups)) setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {updatable && (
          <button type="button" aria-label={`Update ${row.slug}`} disabled={pending} onClick={onUpdate} className={`${buttonClass} bg-surface-2 text-ink`}>
            Update
          </button>
        )}
        {healthy && !editing && (
          <button type="button" aria-label={`Edit groups of ${row.slug}`} disabled={pending} onClick={() => setEditing(true)} className={`${buttonClass} bg-surface-2 text-ink`}>
            Edit groups
          </button>
        )}
        <button type="button" aria-label={`Uninstall ${row.slug}`} disabled={pending} onClick={onUninstall} className={`${buttonClass} bg-surface-2 text-red-600`}>
          Uninstall
        </button>
      </div>
    </article>
  );
}

function GroupEditor({
  slug,
  groups,
  groupNames,
  pending,
  onSave,
  onCancel,
}: {
  slug: string;
  groups: string[] | undefined;
  groupNames: string[];
  pending: boolean;
  onSave: (groups: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  // Seeded from the groups that still exist, so the checkboxes and the payload
  // cannot disagree. See ./skills-groups.tsx for why that matters.
  const [selected, setSelected] = useState<string[]>(() => knownGroups(groups, groupNames));
  const stale = staleGroups(groups, groupNames);

  return (
    <form
      aria-label={`Clearance groups for ${slug}`}
      onSubmit={(event) => { event.preventDefault(); void onSave(selected); }}
      className="grid gap-3 rounded-lg bg-surface-2 p-3"
    >
      <GroupPicker
        groupNames={groupNames}
        selected={selected}
        stale={stale}
        onToggle={(group, next) =>
          setSelected((current) => (next ? [...current, group] : current.filter((name) => name !== group)))
        }
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={`${buttonClass} bg-accent text-white`}>Save groups</button>
        <button type="button" onClick={onCancel} className={`${buttonClass} bg-surface text-ink`}>Cancel</button>
      </div>
    </form>
  );
}
