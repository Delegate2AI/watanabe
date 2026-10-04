"use client";

import { useCallback, useEffect, useState } from "react";
import type { KbGraph } from "@/lib/kb/graph";
import { GraphCanvas } from "./graph-canvas";

/**
 * The fetching wrapper around `GraphCanvas`. It owns `/api/kb/graph` and
 * nothing else: `GraphCanvas` already renders the loading, error, empty,
 * trimmed-graph and no-2D-context states from the props handed down here, so
 * none of that is duplicated in this file.
 *
 * Mounted only inside the Graph tab's `TabsContent`, which Radix unmounts
 * while inactive, so a reader who never opens the tab never triggers this
 * fetch.
 */
export function GraphPanel() {
  const [graph, setGraph] = useState<KbGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped by `retry` to re-run the effect below. Retrying from the effect
  // itself, rather than an imperative fetch function called from it, keeps
  // every state update inside a promise callback instead of the effect body.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/kb/graph")
      .then((res) => {
        if (!res.ok) throw new Error("graph fetch failed");
        return res.json() as Promise<KbGraph>;
      })
      .then((data) => {
        if (!live) return;
        setGraph(data);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(false);
    setAttempt((n) => n + 1);
  }, []);

  return <GraphCanvas graph={graph} loading={loading} error={error} onRetry={retry} />;
}
