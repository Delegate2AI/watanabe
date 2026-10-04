"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { vaultDocHref } from "@/lib/index/web-links";
import type { KbGraph } from "@/lib/kb/graph";
import { stripTaskNodes } from "@/lib/kb/graph-tasks";
import { GraphControls, useForceSettings } from "./graph-controls";
import { useGroupSlots } from "./graph-groups";
import { useGraphScene } from "./graph-scene";
import { useShowTasks } from "./graph-task-toggle";

/**
 * The force-directed link graph, drawn on a single `<canvas>`.
 *
 * Canvas rather than SVG because 2,000 nodes is 2,000 DOM elements the browser
 * would lay out and hit-test on every frame. The consequence is that a screen
 * reader sees pixels, so the canvas carries a summary `aria-label` and the tab
 * that works without sight (the List tab) is named in the fallback line.
 *
 * The canvas element ALWAYS renders, including while loading, on error, and
 * when there is no 2D context. Every other state is an overlay on top of it,
 * never a replacement: swapping the element out would drop the accessible
 * label at exactly the moment it is the only thing a reader has.
 *
 * This file is the shell and the control panel; the live scene's refs and
 * effects live in `graph-scene.ts`, and the group ranking and hue-slot state
 * live in `graph-groups.ts`, so a theme change, a slider drag, a filter
 * keystroke or a legend toggle push into the running simulation instead of
 * rebuilding it.
 */
export interface GraphCanvasProps {
  graph: KbGraph | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

const OVERLAY = "absolute inset-0 grid place-items-center bg-surface-2/85 px-6 text-center";
const NOTE = "text-sm text-ink-muted";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function GraphCanvas({ graph, loading, error, onRetry }: GraphCanvasProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [dark, setDark] = useState(false);
  const [query, setQuery] = useState("");
  /** A group in this set is pinned to a colour slot; clicking it again unpins it. */
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [forces, setForces] = useForceSettings();
  const [showTasks, setShowTasks] = useShowTasks();
  // Task ids in the payload, for routing a click: a task node opens the task
  // detail page, not a note (spec 2026-08-17-kb-task-links-design). A set
  // rather than an id-prefix check, so a note that happens to be named
  // "task-..." keeps opening as a note.
  const taskIds = useMemo(
    () => new Set(graph?.nodes.filter((node) => node.k === "task").map((node) => node.id)),
    [graph],
  );
  // The graph the scene actually mounts: toggling tasks off hands the scene the
  // doc-only graph, which rebuilds and re-settles. A draw-time skip would leave
  // invisible nodes exerting force and unexplained gaps in the layout.
  const shownGraph = useMemo(
    () => (graph && taskIds.size > 0 && !showTasks ? stripTaskNodes(graph) : graph),
    [graph, taskIds, showTasks],
  );
  const { groups, slots } = useGroupSlots(shownGraph, pinned);

  const togglePin = useCallback((group: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  // The shell resolves the system media query first and lets an explicit choice
  // win, so both signals are observed: next-themes for the choice, the media
  // query for the system default and for the case with no provider mounted.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setDark(resolvedTheme ? resolvedTheme === "dark" : media.matches);
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, [resolvedTheme]);

  const { containerRef, canvasRef, noContext } = useGraphScene({
    graph: shownGraph,
    loading,
    dark,
    forces,
    query,
    slots,
    // The same link builder the List tab on this page uses, so a note whose
    // name holds a space, a `#`, a `?` or a `%` opens from both tabs and not
    // just one. `vaultDocHref` takes a vault-relative path and drops a trailing
    // `.md`; a node id is that path already extensionless, which the builder
    // handles (see its "leaves an extensionless path alone" test). A task node
    // carries the task id instead and opens the task detail page.
    onOpen: (id) => router.push(taskIds.has(id) ? `/tasks/${encodeURIComponent(id)}` : vaultDocHref(id)),
  });

  const docCount = (shownGraph?.nodes.length ?? 0) - (showTasks ? taskIds.size : 0);
  const shownTaskCount = showTasks ? taskIds.size : 0;
  const label =
    `Link graph: ${plural(docCount, "note")}, ` +
    (shownTaskCount > 0 ? `${plural(shownTaskCount, "task")}, ` : "") +
    plural(shownGraph?.edges.length ?? 0, "link");

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-card border border-line bg-surface-2"
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="block h-full w-full touch-none" />

      {graph !== null && docCount < graph.total && (
        <p className="absolute left-3 top-3 rounded-menu bg-surface-2/85 px-2 py-1 text-xs text-ink-muted">
          Showing {docCount.toLocaleString()} of {graph.total.toLocaleString()} notes
        </p>
      )}

      {shownGraph !== null && shownGraph.nodes.length > 0 && (
        <GraphControls
          query={query}
          onQuery={setQuery}
          groups={groups}
          slots={slots}
          pinned={pinned}
          onTogglePin={togglePin}
          forces={forces}
          onForces={setForces}
          dark={dark}
          hasTasks={taskIds.size > 0}
          showTasks={showTasks}
          onShowTasks={setShowTasks}
        />
      )}

      {noContext && (
        <p className="absolute inset-x-0 bottom-3 px-4 text-center text-xs text-ink-muted">
          This browser cannot draw the graph. Use the List tab for the same notes.
        </p>
      )}

      {loading && (
        <div role="status" className={`${OVERLAY} ${NOTE}`}>
          Loading the link graph
        </div>
      )}

      {error && (
        <div className={OVERLAY}>
          <div className="flex flex-col items-center gap-3">
            <p className={NOTE}>The link graph could not be loaded.</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-menu border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {!loading && !error && graph !== null && graph.nodes.length === 0 && (
        <div className={`${OVERLAY} ${NOTE}`}>
          The knowledge base is empty, or the index has not been built yet.
        </div>
      )}
    </div>
  );
}
