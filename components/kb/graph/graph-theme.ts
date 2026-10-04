/**
 * Canvas cannot reference a CSS variable, so the palette is read out of CSS once
 * and handed to the draw code as plain strings. Every colour the graph paints
 * comes from this snapshot, which is what makes it theme in light and dark with
 * no rules of its own.
 *
 * THE TOKENS READ HERE ARE THE SHELL TOKENS, declared on `:root` in
 * `app/design-tokens.css` with light, dark and both `[data-theme]` variants. The
 * prose tokens (`--prose-surface` and friends) look like the right names but are
 * declared ONLY on `.md`, and the graph container has no `.md` ancestor on
 * `/map`, so reading those returned "" for every colour and the graph painted
 * the light fallbacks in both modes.
 *
 * The group hues are the one thing NOT taken from the design system, because a
 * categorical scale is intrinsic to the feature and no token supplies one.
 *
 * THREE HUES IS A MEASURED LIMIT, NOT A PREFERENCE. A force layout can place
 * any two nodes side by side, so the palette has to clear the `dataviz`
 * checker's ALL-PAIRS colour-vision floors, not its adjacent pairlist. Against
 * this app's surfaces the reference palette's eight hues fail hard (worst
 * normal-vision deltaE 7.1, worst CVD 3.2), and no four-hue set clears both
 * modes: the dark surface forces blue and violet into the same lightness band
 * and they collapse. Three clears everything in both modes. Do not add a
 * fourth; fold extra groups to neutral, which is what `assignGroupSlots` does.
 */

import type { GraphNode } from "@/lib/kb/graph";

export interface GroupHue {
  light: string;
  dark: string;
}

/** Slots 1 to 3 of the validated categorical order: blue, orange, aqua. */
export const GROUP_HUES: readonly GroupHue[] = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
];

export interface GraphPalette {
  surface: string;
  /** Nodes in no coloured group, and the base ink for labels. */
  nodeNeutral: string;
  edge: string;
  label: string;
  /** The three group colours, already stepped for the current mode. */
  groups: string[];
}

/**
 * Last-resort colours, used only when a token is missing from the cascade, for
 * instance in a test that renders the canvas with no stylesheet loaded. These
 * are light-mode values, so a graph that silently falls through to them looks
 * right in light mode and wrong in dark: `graph-theme.test.ts` asserts the two
 * modes differ against the real token file rather than trusting the appearance.
 */
const FALLBACK = {
  surface: "#f4f2eb",
  nodeNeutral: "#5a5a5a",
  edge: "#c8c8c8",
  label: "#0b0b0b",
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

export function readGraphPalette(probe: Element, dark: boolean): GraphPalette {
  const styles = getComputedStyle(probe);
  return {
    surface: readVar(styles, "--surface-2", FALLBACK.surface),
    nodeNeutral: readVar(styles, "--ink-muted", FALLBACK.nodeNeutral),
    edge: readVar(styles, "--line", FALLBACK.edge),
    label: readVar(styles, "--ink", FALLBACK.label),
    groups: GROUP_HUES.map((hue) => (dark ? hue.dark : hue.light)),
  };
}

/**
 * The distinct groups ordered by note count descending, which is both what
 * `assignGroupSlots` wants and the order the legend reads best in.
 *
 * A note at the vault root has no top-level directory and travels as `g: ""`.
 * That empty key IS a group here, ranked and slottable like any other: it was
 * skipped before, which left root-level notes permanently neutral, missing from
 * the legend and impossible to pin, with nothing on screen saying why. The wire
 * format is unchanged; `groupLabel` in `graph-legend.tsx` is what turns the
 * empty key into "Vault root" for the reader.
 */
export function rankGroups(nodes: readonly GraphNode[]): string[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.g, (counts.get(node.g) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([group]) => group);
}

/**
 * Which groups get a hue. `groups` arrives ordered by note count descending, so
 * with nothing selected the three largest sections are coloured and the rest
 * render neutral. A legend click puts a group in `selected`, which protects it
 * from eviction so it keeps a slot even past the first three.
 *
 * Slot assignment follows the group, never its rank on screen: pinning or
 * unpinning one group must not repaint the ones that remain, so the desired
 * set is computed from the stable `groups` list, not from which groups are
 * currently pinned.
 *
 * The desired set can still change size as selection changes, and a compaction
 * of that set would shift every survivor's index whenever the set's size does,
 * repainting groups the reader never touched. `previous` is the prior call's
 * result: a survivor keeps its old slot when that slot is still free, and only
 * a group with no prior slot, or whose prior slot was claimed by a longer-
 * standing survivor, takes the lowest index still free.
 */
export function assignGroupSlots(
  groups: readonly string[],
  selected: ReadonlySet<string> = new Set(),
  previous: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const capacity = GROUP_HUES.length;
  const required = groups.filter((group) => selected.has(group));
  const optional = groups.filter((group) => !selected.has(group));
  const budget = Math.max(capacity - required.length, 0);
  const kept = new Set(optional.slice(0, budget));
  const desired = groups.filter((group) => selected.has(group) || kept.has(group)).slice(0, capacity);

  const slots = new Map<string, number>();
  const taken = new Set<number>();

  for (const group of desired) {
    const priorSlot = previous.get(group);
    if (priorSlot !== undefined && !taken.has(priorSlot)) {
      slots.set(group, priorSlot);
      taken.add(priorSlot);
    }
  }

  let nextFree = 0;
  for (const group of desired) {
    if (slots.has(group)) continue;
    while (taken.has(nextFree)) nextFree++;
    slots.set(group, nextFree);
    taken.add(nextFree);
  }

  return slots;
}
