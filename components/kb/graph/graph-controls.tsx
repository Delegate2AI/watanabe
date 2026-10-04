"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { GraphLegend } from "./graph-legend";
import { DEFAULT_FORCES, type ForceSettings } from "./graph-sim";

/**
 * The controls panel that overlays the graph canvas, mirroring Obsidian's:
 * Filters, Groups, Forces, each in a native `<details>` so a reader can fold
 * away a section, at no JavaScript cost to open one.
 *
 * Sliders are native `<input type="range">`: a design-system slider would buy
 * keyboard handling and a focus ring the platform already supplies here, at
 * the cost of a dependency this app does not otherwise carry.
 *
 * The panel owns no graph state. Every control reports upward and the canvas
 * pushes the result into the live scene, so a drag retunes the running
 * simulation instead of rebuilding it.
 *
 * The Groups section is `graph-legend.tsx`, which is also where a group key
 * becomes the label a reader sees.
 */

const STORAGE_KEY = "kb-graph-forces";

export interface GraphControlsProps {
  query: string;
  onQuery: (query: string) => void;
  /** Ordered by note count descending, which is the order the legend shows. */
  groups: readonly string[];
  slots: ReadonlyMap<string, number>;
  /** Groups pinned to a colour slot past the default top three. */
  pinned: ReadonlySet<string>;
  onTogglePin: (group: string) => void;
  forces: ForceSettings;
  onForces: (forces: ForceSettings) => void;
  dark?: boolean;
  /** True when the payload actually contains task nodes; hides the toggle otherwise. */
  hasTasks?: boolean;
  showTasks?: boolean;
  onShowTasks?: (show: boolean) => void;
}

type SliderSpec = { key: keyof ForceSettings; label: string; min: number; max: number; step: number };

/** Ranges chosen so the default sits mid-scale and both ends stay usable. */
const SLIDERS: readonly SliderSpec[] = [
  { key: "center", label: "Center force", min: 0, max: 0.2, step: 0.005 },
  { key: "repel", label: "Repel force", min: 0, max: 400, step: 5 },
  { key: "link", label: "Link force", min: 0, max: 1, step: 0.05 },
  { key: "linkDistance", label: "Link distance", min: 5, max: 200, step: 5 },
];

/**
 * Reads the stored forces, validating every key: a stored `NaN`, string or
 * null reaching `forceManyBody().strength()` puts every node at `NaN`
 * coordinates and the canvas silently goes blank, so anything that is not a
 * finite number falls back to the default for that key.
 */
export function loadForces(): ForceSettings {
  if (typeof localStorage === "undefined") return DEFAULT_FORCES;
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return DEFAULT_FORCES;
  }
  if (stored === null || typeof stored !== "object") return DEFAULT_FORCES;
  const record = stored as Record<string, unknown>;
  const forces = { ...DEFAULT_FORCES };
  for (const key of Object.keys(DEFAULT_FORCES) as (keyof ForceSettings)[]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) forces[key] = value;
  }
  return forces;
}

export function saveForces(forces: ForceSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(forces));
  } catch {
    // A full or blocked store costs the tuning, never the graph itself.
  }
}

const noSubscription = () => () => {};

/** False on the server and the first client render, true once hydrated. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * Force state plus its `localStorage` round trip: `DEFAULT_FORCES` until
 * hydration, then the stored value, adjusted here rather than in an effect
 * (the repo's lint blocks `setState` in an effect body, see
 * `appearance-toggle.tsx`), so hydration stays quiet either way.
 */
export function useForceSettings(): [ForceSettings, (next: ForceSettings) => void] {
  const hydrated = useHydrated();
  const [wasHydrated, setWasHydrated] = useState(false);
  const [forces, setForces] = useState<ForceSettings>(DEFAULT_FORCES);
  if (hydrated && !wasHydrated) {
    setWasHydrated(true);
    setForces(loadForces());
  }
  const update = useCallback((next: ForceSettings) => {
    setForces(next);
    saveForces(next);
  }, []);
  return [forces, update];
}

const SECTION = "border-t border-line px-3 py-2 first:border-t-0";
const SUMMARY = "cursor-pointer select-none text-xs font-medium text-ink";

export function GraphControls(props: GraphControlsProps) {
  const { groups, slots, pinned, forces, dark = false } = props;
  // Unique per mounted panel, so two canvases (or a hot-reloaded one) never
  // cross-wire a `<label htmlFor>` to the wrong panel's input.
  const uid = useId();
  const filterId = `${uid}-filter`;

  return (
    // Capped to the graph pane's height and scrolling internally: the pane
    // clips with `overflow-hidden`, so without the cap an open Forces section
    // (or a long legend) grows past the bottom edge and its controls are cut
    // off with no way to reach them. 1.5rem is the `top-3` offset plus the
    // matching bottom gap.
    <div
      data-testid="graph-controls-panel"
      className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-56 overflow-y-auto overscroll-contain rounded-card border border-line bg-surface-2/90 shadow-sm backdrop-blur"
    >
      <details open className={SECTION}>
        <summary className={SUMMARY}>Filters</summary>
        <label htmlFor={filterId} className="mt-2 block text-xs text-ink-muted">
          Filter
        </label>
        <input
          id={filterId}
          type="search"
          value={props.query}
          placeholder="Title or path"
          onChange={(event) => props.onQuery(event.target.value)}
          className="mt-1 w-full rounded-menu border border-line bg-surface px-2 py-1 text-xs text-ink"
        />
        {props.hasTasks && props.onShowTasks && (
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={props.showTasks ?? true}
              onChange={(event) => props.onShowTasks?.(event.target.checked)}
              className="accent-accent"
            />
            Show tasks
          </label>
        )}
      </details>

      <details open className={SECTION}>
        <summary className={SUMMARY}>Groups</summary>
        <GraphLegend
          groups={groups}
          slots={slots}
          pinned={pinned}
          onTogglePin={props.onTogglePin}
          dark={dark}
        />
      </details>

      <details className={SECTION}>
        <summary className={SUMMARY}>Forces</summary>
        <div className="mt-2 flex flex-col gap-2">
          {SLIDERS.map((slider) => (
            <div key={slider.key}>
              <label htmlFor={`${uid}-${slider.key}`} className="block text-xs text-ink-muted">
                {slider.label}
              </label>
              <input
                id={`${uid}-${slider.key}`}
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={forces[slider.key]}
                onChange={(event) =>
                  props.onForces({ ...forces, [slider.key]: Number(event.target.value) })
                }
                className="w-full accent-accent"
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
