import type { KbGraph } from "@/lib/kb/graph";
import type { PositionedNode, Viewport } from "./graph-draw";
import { readGraphPalette } from "./graph-theme";
import { buildAdjacency, drawScene, type Scene } from "./graph-render";
import { attachPointer } from "./graph-pointer";
import { applyForces, createSimulation, type ForceSettings } from "./graph-sim";

/**
 * Everything the canvas does between mount and unmount: seed positions, size to
 * the container, run the simulation on the animation frame, and wire the
 * pointer. It lives outside the component because none of it is React, and
 * because the component is the file most at risk of growing without limit.
 *
 * Returns a handle onto the LIVE scene, not just its teardown. Every control
 * the reader can touch, the theme, the four force sliders, the filter box and
 * the group legend, pushes through that handle and repaints. Rebuilding the
 * scene for any of them would restart the layout, so a dark-mode toggle or a
 * slider nudge would throw away a settled graph and re-settle it under the
 * reader. Only a change of `graph` itself is worth a rebuild.
 */

/** Golden-angle spiral, so the first frame is not a single overlapping blob. */
const SEED_STEP = 14;
/** Reheat target when a drag needs the neighbours to follow. */
const REHEAT_ALPHA = 0.15;
/**
 * Reduced-motion `settle()` ticks synchronously on the main thread, so it is
 * bounded rather than run to `alphaMin`: at 2,000 nodes, unbounded measured
 * at several seconds of a frozen tab, repeated on every step of a slider
 * drag. 120 ticks gives a reader a slightly less relaxed layout in exchange
 * for a tab that stays responsive.
 */
const REDUCED_MOTION_TICKS = 120;

export interface GraphView {
  query: string;
  slots: ReadonlyMap<string, number>;
}

export interface MountOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  graph: KbGraph;
  dark: boolean;
  forces: ForceSettings;
  view: GraphView;
  /** Owned by the component, so pan and zoom survive a theme change. */
  viewport: Viewport;
  centered: { current: boolean };
  onOpen: (id: string) => void;
}

/** The live scene, as the component is allowed to touch it. */
export interface GraphScene {
  /** Retunes the running simulation, so a drag is legible as it happens. */
  setForces: (forces: ForceSettings) => void;
  /** Re-reads the palette out of CSS for the new mode and repaints. */
  setDark: (dark: boolean) => void;
  /** Filter text and hue slots, both repaint-only. */
  setView: (view: GraphView) => void;
  destroy: () => void;
}

export function mountGraph(options: MountOptions): GraphScene {
  const { container, canvas, ctx, graph, viewport } = options;

  const nodes: PositionedNode[] = graph.nodes.map((node, i) => ({
    ...node,
    x: Math.cos(i * 2.399) * SEED_STEP * Math.sqrt(i),
    y: Math.sin(i * 2.399) * SEED_STEP * Math.sqrt(i),
  }));
  const adjacency = buildAdjacency(nodes, graph.edges);

  const scene: Scene = {
    nodes,
    edges: graph.edges,
    viewport,
    hover: null,
    highlight: new Set(),
    palette: readGraphPalette(container, options.dark),
    slots: options.view.slots,
    query: options.view.query,
    width: 0,
    height: 0,
    dpr: 1,
  };
  const draw = () => drawScene(ctx, scene);

  // Measured on the canvas, never on the container: the container carries a 1px
  // border, so its rect is 2px larger than the canvas inside it, and the pointer
  // code hit-tests against the canvas. Measuring the wrong box drifts the drawn
  // position away from the picked one, worst at the right and bottom edges.
  // Nothing here writes `canvas.style` either: only the backing store is scaled
  // for the DPR. The `h-full w-full` classes do the rest, but `h-full` resolves
  // to nothing on its own, so the definite height has to come from an ancestor
  // (on `/map` that is the graph `TabsContent`, see `components/map/map-tabs.tsx`).
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    scene.dpr = window.devicePixelRatio || 1;
    scene.width = rect.width;
    scene.height = rect.height;
    canvas.width = Math.round(rect.width * scene.dpr);
    canvas.height = Math.round(rect.height * scene.dpr);
    if (!options.centered.current && rect.width > 0) {
      viewport.x = rect.width / 2;
      viewport.y = rect.height / 2;
      options.centered.current = true;
    }
    draw();
  };

  const simulation = createSimulation(nodes, graph.edges, options.forces);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (simulation.alpha() > simulation.alphaMin()) {
      simulation.tick();
      frame = requestAnimationFrame(tick);
    }
    draw();
  };
  const schedule = () => {
    if (frame === 0 && !reduced) frame = requestAnimationFrame(tick);
  };
  // `d3-force` only copies `fx`/`fy` onto `x`/`y` inside `tick()`, so under
  // reduced motion, where nothing is scheduled, a drag has to tick by hand or
  // the pinned node never moves at all while pan and zoom keep working.
  const reheat = () => {
    simulation.alpha(Math.max(simulation.alpha(), REHEAT_ALPHA));
    if (reduced) {
      simulation.tick();
      draw();
    } else {
      schedule();
    }
  };
  /** Watch it settle, or under reduced motion run a bounded tick budget and paint once. */
  const settle = () => {
    if (reduced) {
      for (let i = 0; i < REDUCED_MOTION_TICKS && simulation.alpha() > simulation.alphaMin(); i++) {
        simulation.tick();
      }
      draw();
    } else {
      schedule();
    }
  };

  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resize());
  observer?.observe(canvas);
  canvas.style.cursor = "grab";
  resize();

  settle();

  const detach = attachPointer(canvas, {
    scene,
    onHover: (node) => {
      if (scene.hover === node) return;
      scene.hover = node;
      scene.highlight = node ? new Set([node, ...(adjacency.get(node) ?? [])]) : new Set();
      canvas.style.cursor = node ? "pointer" : "grab";
      draw();
    },
    onOpen: options.onOpen,
    reheat,
    draw,
  });

  return {
    setForces: (forces) => {
      applyForces(simulation, forces);
      settle();
    },
    setDark: (dark) => {
      scene.palette = readGraphPalette(container, dark);
      draw();
    },
    setView: (view) => {
      scene.query = view.query;
      scene.slots = view.slots;
      draw();
    },
    destroy: () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      detach();
      simulation.stop();
      // The cursor was ours to set, so it is ours to give back: the canvas
      // element outlives this scene on a rebuild, and a stale "pointer" would
      // sit there over a graph that no longer has anything under it.
      canvas.style.cursor = "";
    },
  };
}
