"use client";

import { GROUP_HUES } from "./graph-theme";

/**
 * The Groups section of the controls panel: one row per group, in the ranked
 * order the canvas colours them in, each a toggle that pins its group to a hue
 * slot.
 *
 * Split out of `graph-controls.tsx` so that file stays under the size gate, and
 * because this is the one place the wire format's group key becomes a label a
 * reader sees.
 */

/** A group with no hue slot renders in this instead. */
const NEUTRAL = "var(--ink-muted)";

/**
 * A note at the vault root has no top-level directory, so it travels as `g: ""`.
 * That is the honest payload and stays as it is, but an empty legend row is not
 * something to show anyone. `/map`'s list calls that section "Vault root" (see
 * `app/(app)/map/page.tsx`), so the graph names it the same thing rather than
 * inventing a second word for one place.
 */
export const ROOT_GROUP_LABEL = "Vault root";

export function groupLabel(group: string): string {
  return group === "" ? ROOT_GROUP_LABEL : group;
}

export interface GraphLegendProps {
  /** Ordered by note count descending, which is the order the legend shows. */
  groups: readonly string[];
  slots: ReadonlyMap<string, number>;
  /** Groups pinned to a colour slot past the default top three. */
  pinned: ReadonlySet<string>;
  onTogglePin: (group: string) => void;
  dark: boolean;
}

export function GraphLegend({ groups, slots, pinned, onTogglePin, dark }: GraphLegendProps) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {groups.map((group) => {
        const slot = slots.get(group);
        const hue = slot === undefined ? undefined : GROUP_HUES[slot];
        const isPinned = pinned.has(group);
        return (
          <li key={group}>
            <button
              type="button"
              aria-pressed={isPinned}
              onClick={() => onTogglePin(group)}
              className={`flex w-full items-center gap-2 rounded-menu px-1 py-0.5 text-left text-xs text-ink hover:bg-surface-hover ${
                isPinned ? "bg-surface-hover font-medium" : ""
              }`}
            >
              <span
                data-testid={`swatch-${group === "" ? "root" : group}`}
                data-slot={slot ?? "none"}
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: hue ? (dark ? hue.dark : hue.light) : NEUTRAL }}
              />
              <span className="truncate">{groupLabel(group)}</span>
            </button>
          </li>
        );
      })}
      {groups.length === 0 && <li className="text-xs text-ink-muted">No sections</li>}
    </ul>
  );
}
