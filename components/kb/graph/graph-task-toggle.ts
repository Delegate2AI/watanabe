"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * The "Show tasks" toggle's state and its `localStorage` round trip (spec
 * 2026-08-17-kb-task-links-design). A separate module rather than more of
 * `graph-controls.tsx` only for file-size budget; the hydration shape is the
 * same as `useForceSettings` there, and for the same reason: default until
 * hydrated, then the stored value, adjusted in render rather than in an effect
 * (the repo's lint blocks `setState` in an effect body).
 *
 * Toggling filters the graph object handed to the scene, which rebuilds and
 * re-settles. Hiding by draw-time skip was considered and rejected: invisible
 * nodes would still exert force and leave unexplained gaps in the layout.
 */

const STORAGE_KEY = "kb-graph-show-tasks";

export function loadShowTasks(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveShowTasks(show: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
  } catch {
    // A full or blocked store costs the preference, never the graph itself.
  }
}

const noSubscription = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

export function useShowTasks(): [boolean, (next: boolean) => void] {
  const hydrated = useHydrated();
  const [wasHydrated, setWasHydrated] = useState(false);
  const [show, setShow] = useState(true);
  if (hydrated && !wasHydrated) {
    setWasHydrated(true);
    setShow(loadShowTasks());
  }
  const update = useCallback((next: boolean) => {
    setShow(next);
    saveShowTasks(next);
  }, []);
  return [show, update];
}
