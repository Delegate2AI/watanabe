"use client";

import { useMemo, useState } from "react";
import type { KbGraph } from "@/lib/kb/graph";
import { assignGroupSlots, rankGroups } from "./graph-theme";

export interface GroupSlots {
  /** Ranked by note count descending, which is the order the legend shows. */
  groups: readonly string[];
  slots: ReadonlyMap<string, number>;
}

/**
 * The groups a graph has, and their hue slots kept stable across renders.
 * `assignGroupSlots`'s `previous` argument is what lets pinning (or
 * unpinning) a group leave every other group's colour exactly where it was,
 * so the slot Map has to persist across renders and be recomputed whenever
 * `graph` or `pinned` changes.
 *
 * Adjusted in-render rather than in an effect: the "state derived from its
 * own previous value" pattern React documents, used because this repo's
 * react-hooks lint blocks `setState` inside an effect body.
 */
export function useGroupSlots(graph: KbGraph | null, pinned: ReadonlySet<string>): GroupSlots {
  const groups = useMemo(() => (graph ? rankGroups(graph.nodes) : []), [graph]);
  const [slots, setSlots] = useState(() => assignGroupSlots(groups, pinned));
  const [prevGroups, setPrevGroups] = useState(groups);
  const [prevPinned, setPrevPinned] = useState(pinned);
  if (groups !== prevGroups || pinned !== prevPinned) {
    setPrevGroups(groups);
    setPrevPinned(pinned);
    setSlots(assignGroupSlots(groups, pinned, slots));
  }
  return { groups, slots };
}
