"use client";

/**
 * The clearance-group checkbox set, shared by the install form and the per-skill
 * group editor so the two cannot drift on what a valid group is.
 *
 * The filtering here is the point. A group recorded on a skill that no longer
 * exists in access/groups.yaml gets no checkbox, so nothing in the UI can
 * uncheck it, and carrying it into the submitted payload would keep it alive
 * through every save: the day that name is reused for an unrelated group, the
 * skill would silently grant itself to those members. So stored groups are
 * filtered against the live list, and the drop is named rather than done
 * quietly. Spec 33's connectors form learned this the same way.
 */

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-faint";

/** The stored groups that still exist, in the order the file recorded them. */
export function knownGroups(groups: string[] | undefined, groupNames: string[]): string[] {
  return (groups ?? []).filter((group) => groupNames.includes(group));
}

/** The stored groups that do not, which is what the notice names. */
export function staleGroups(groups: string[] | undefined, groupNames: string[]): string[] {
  return (groups ?? []).filter((group) => !groupNames.includes(group));
}

export function GroupPicker({
  groupNames,
  selected,
  stale,
  onToggle,
}: {
  groupNames: string[];
  selected: string[];
  /** Recorded groups that no longer exist. Empty on an install, where there are none yet. */
  stale?: string[];
  onToggle: (group: string, next: boolean) => void;
}) {
  const dropped = stale ?? [];
  return (
    <fieldset className="grid gap-1">
      <legend className={labelClass}>Clearance groups</legend>
      <div className="flex flex-wrap gap-3 pt-1">
        {groupNames.length === 0 && (
          <span className="text-sm text-ink-muted">
            No groups exist yet. Create one under Access administration.
          </span>
        )}
        {groupNames.map((group) => (
          <label key={group} className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={selected.includes(group)}
              onChange={(event) => onToggle(group, event.target.checked)}
            />
            {group}
          </label>
        ))}
      </div>
      <span className="text-xs text-ink-faint">
        Only a session cleared for a listed group is given this skill. No group means nobody.
      </span>
      {dropped.length > 0 && (
        <p className="text-xs text-amber-600 text-pretty" data-testid="stale-groups">
          {dropped.join(", ")} no longer exist{dropped.length === 1 ? "s" : ""} in access/groups.yaml and
          clear{dropped.length === 1 ? "s" : ""} nobody. Saving drops {dropped.length === 1 ? "it" : "them"} from
          this skill.
        </p>
      )}
    </fieldset>
  );
}
