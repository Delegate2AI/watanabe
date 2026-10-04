"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { KbGraph } from "@/lib/kb/graph";
import type { Viewport } from "./graph-draw";
import type { ForceSettings } from "./graph-sim";
import { mountGraph, type GraphScene } from "./graph-mount";

export interface UseGraphSceneOptions {
  graph: KbGraph | null;
  loading: boolean;
  dark: boolean;
  forces: ForceSettings;
  query: string;
  slots: ReadonlyMap<string, number>;
  onOpen: (id: string) => void;
}

export interface GraphSceneRefs {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  noContext: boolean;
}

/**
 * Owns the live scene's lifecycle: the DOM refs the canvas mounts onto, the
 * `GraphScene` handle `mountGraph` returns, and the effects that either
 * rebuild it (only on `graph`/`loading`) or push into it live (theme, forces,
 * filter, legend). Pulled out of `graph-canvas.tsx`, since none of this needs
 * to sit next to the JSX to be reviewed, and this piece is where a reviewer
 * keeps finding the bugs.
 */
export function useGraphScene(options: UseGraphSceneOptions): GraphSceneRefs {
  const { graph, loading, dark, forces, query, slots, onOpen } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, k: 1 });
  const centeredRef = useRef(false);
  const [noContext, setNoContext] = useState(false);
  /** True once the first commit's effects have all run. See the push effects below. */
  const mountedRef = useRef(false);
  /** Always the latest `onOpen`, so the mount effect below does not need it as a dep. */
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  // Rebuilds the scene. Narrow deps on purpose: `graph` is a new layout, and
  // `loading` because a retry has to tear the stale scene down and clear the
  // fallback line, rather than leave both describing a graph that no longer
  // shows. Theme, forces, filter text and the legend push into the live scene
  // through the effects below instead of rebuilding it.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    // Cleared on every path, not only when true, so a graph going back to
    // loading or to empty does not leave this stacked under its replacement.
    if (!container || !canvas || loading || !graph || graph.nodes.length === 0) {
      setNoContext(false);
      return;
    }
    const ctx = canvas.getContext("2d");
    setNoContext(ctx === null);
    if (!ctx) return;

    const scene = mountGraph({
      container,
      canvas,
      ctx,
      graph,
      dark,
      forces,
      view: { query, slots },
      viewport: viewportRef.current,
      centered: centeredRef,
      onOpen: (id) => onOpenRef.current(id),
    });
    sceneRef.current = scene;

    return () => {
      sceneRef.current = null;
      scene.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, loading]);

  // These push straight into the live scene without a rebuild, EXCEPT on the
  // commit that just built it: React runs every effect on mount regardless of
  // whether its own deps "changed", so without `mountedRef` each would
  // immediately re-push the values `mountGraph` was just built with. For
  // `setForces` that is not a no-op: it cuts alpha from 1 to 0.3 and loses the
  // high-energy phase that untangles the layout, and under reduced motion it
  // runs a second bounded settle on top of the one mounting already did.
  useEffect(() => {
    if (mountedRef.current) sceneRef.current?.setDark(dark);
  }, [dark]);
  useEffect(() => {
    if (mountedRef.current) sceneRef.current?.setForces(forces);
  }, [forces]);
  useEffect(() => {
    if (mountedRef.current) sceneRef.current?.setView({ query, slots });
  }, [query, slots]);
  useEffect(() => {
    mountedRef.current = true;
  }, []);

  return { containerRef, canvasRef, noContext };
}
