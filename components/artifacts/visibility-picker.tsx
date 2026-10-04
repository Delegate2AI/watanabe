"use client";

import { X } from "lucide-react";
import { personLabel } from "@/components/person-chip";
import type { VisibilityOptions } from "@/lib/authority/visibility-options";

/**
 * Picks KB visibility as a set of group chips (spec 27). Replaces the old
 * comma-separated free-text field. The value in/out is a comma-separated string
 * of group names (what the artifact stores), so the parent editor is unchanged.
 *
 * You add a group directly, or add a PERSON, which expands to that person's
 * groups: the stored value is always groups, matching the clearance model. With
 * authority off the only option is `all-hands`.
 */
function parse(value: string): string[] {
  return value.split(",").map((g) => g.trim()).filter(Boolean);
}

export function VisibilityPicker({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: VisibilityOptions;
  disabled?: boolean;
}) {
  const selected = parse(value);
  const has = (group: string) => selected.includes(group);

  function commit(next: string[]) {
    const deduped = Array.from(new Set(next));
    onChange(deduped.join(", "));
  }

  function addGroups(groups: string[]) {
    commit([...selected, ...groups.filter((g) => !has(g))]);
  }

  function remove(group: string) {
    commit(selected.filter((g) => g !== group));
  }

  function onAdd(raw: string) {
    if (!raw) return;
    if (raw.startsWith("group:")) addGroups([raw.slice("group:".length)]);
    else if (raw.startsWith("person:")) {
      const email = raw.slice("person:".length);
      const person = options.people.find((p) => p.email === email);
      if (person) addGroups(person.groups);
    }
  }

  // Only offer groups not already selected, and only people who would add
  // something new (they have at least one not-yet-selected group).
  const addableGroups = options.groups.filter((g) => !has(g));
  const addablePeople = options.people.filter((p) => p.groups.some((g) => !has(g)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5" role="list" aria-label="Selected visibility">
        {selected.length === 0 ? (
          <span className="text-xs text-ink-faint">No groups selected (defaults to all-hands).</span>
        ) : (
          selected.map((group) => (
            <span
              key={group}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink"
            >
              {group}
              <button
                type="button"
                onClick={() => remove(group)}
                disabled={disabled}
                aria-label={`Remove ${group}`}
                className="text-ink-faint hover:text-ink disabled:opacity-50"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>
      <select
        aria-label="Add group or person"
        disabled={disabled}
        value=""
        onChange={(e) => onAdd(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
      >
        <option value="">Add group or person</option>
        {addableGroups.length > 0 ? (
          <optgroup label="Groups">
            {addableGroups.map((g) => (
              <option key={`group:${g}`} value={`group:${g}`}>{g}</option>
            ))}
          </optgroup>
        ) : null}
        {addablePeople.length > 0 ? (
          <optgroup label="People">
            {addablePeople.map((p) => (
              // The VALUE keeps the address: the picker posts it back and the
              // API resolves it against the roster. Only the label changes.
              <option key={`person:${p.email}`} value={`person:${p.email}`}>
                {personLabel(p.person, "option")} ({p.groups.join(", ")})
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}
