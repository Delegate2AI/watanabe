"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Live vault re-render on staging (spec 15 D33): the vault tree /
 * dir listing / diff panels are server components, so the only way they
 * learn "the agent just staged a file" is a router.refresh() — which
 * re-runs them while PRESERVING all client state here (the same contract
 * DraftBanner's discard already relies on). Trailing-debounced so a turn
 * that stages several files in a burst re-renders once, not N times;
 * `turn_result` flushes immediately so the settled turn always shows the
 * final on-disk state.
 */
export function useRouterRefresh() {
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftMutatedRef = useRef(false);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  const scheduleRouterRefresh = useCallback(() => {
    draftMutatedRef.current = true;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, 500);
  }, [router]);

  const flushRouterRefresh = useCallback(() => {
    if (!draftMutatedRef.current) return;
    draftMutatedRef.current = false;
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    router.refresh();
  }, [router]);

  return { router, scheduleRouterRefresh, flushRouterRefresh };
}
