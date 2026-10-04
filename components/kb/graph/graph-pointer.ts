import { pickNode, screenToWorld, type PositionedNode } from "./graph-draw";
import type { Scene } from "./graph-render";

/**
 * Pointer and wheel wiring for the graph canvas, kept out of the component
 * because it is long, stateful in a way React state would only get in the way
 * of, and has nothing to do with rendering.
 *
 * All of it mutates the `Scene` in place and asks for a repaint. Nothing here
 * touches React.
 */

/** `d3-force` reads `fx`/`fy` as a pin. Our node type does not declare them. */
type PinnableNode = PositionedNode & { fx?: number | null; fy?: number | null };

export interface PointerHooks {
  scene: Scene;
  onHover: (node: PositionedNode | null) => void;
  onOpen: (id: string) => void;
  /** Reheat the simulation, because a dragged node has to drag its neighbours. */
  reheat: () => void;
  draw: () => void;
}

/** A press that travels further than this is a drag, not a click. */
const CLICK_SLOP_PX = 4;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
/** Wheel delta to zoom exponent. One notch is roughly a 12 percent change. */
const ZOOM_RATE = 0.0015;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function attachPointer(canvas: HTMLCanvasElement, hooks: PointerHooks): () => void {
  const { scene } = hooks;
  let dragging: PinnableNode | null = null;
  let panning = false;
  let pressed: PositionedNode | null = null;
  let travelled = 0;
  let lastX = 0;
  let lastY = 0;

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const nodeAt = (point: { x: number; y: number }) =>
    pickNode(scene.nodes, screenToWorld(point, scene.viewport), scene.viewport.k);

  const onPointerDown = (event: PointerEvent) => {
    // Primary button only, so a right-click on a node opens the context menu
    // rather than navigating away from the graph on release.
    if (event.button !== 0) return;
    const point = local(event);
    const node = nodeAt(point);
    travelled = 0;
    lastX = point.x;
    lastY = point.y;
    pressed = node;
    if (node) {
      dragging = node as PinnableNode;
      dragging.fx = node.x;
      dragging.fy = node.y;
      hooks.reheat();
    } else {
      panning = true;
    }
    canvas.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    const point = local(event);
    travelled += Math.hypot(point.x - lastX, point.y - lastY);
    const dx = point.x - lastX;
    const dy = point.y - lastY;
    lastX = point.x;
    lastY = point.y;

    if (dragging) {
      const world = screenToWorld(point, scene.viewport);
      dragging.fx = world.x;
      dragging.fy = world.y;
      hooks.reheat();
      return;
    }
    if (panning) {
      scene.viewport.x += dx;
      scene.viewport.y += dy;
      hooks.draw();
      return;
    }
    hooks.onHover(nodeAt(point));
  };

  /** Unpin, stop panning, forget the press. Shared by every way a gesture ends. */
  const endGesture = () => {
    if (dragging) {
      // Released, not pinned: the layout stays live so the graph keeps settling.
      dragging.fx = null;
      dragging.fy = null;
      dragging = null;
      hooks.reheat();
    }
    panning = false;
  };

  const onPointerUp = (event: PointerEvent) => {
    canvas.releasePointerCapture?.(event.pointerId);
    endGesture();
    if (pressed && travelled <= CLICK_SLOP_PX) hooks.onOpen(pressed.id);
    pressed = null;
  };

  /**
   * A cancelled gesture is one the browser took away, never one the reader
   * completed, so it must not navigate. Dropping `pressed` first is what
   * separates it from `onPointerUp`.
   */
  const onPointerCancel = (event: PointerEvent) => {
    pressed = null;
    onPointerUp(event);
  };

  // Only reachable when pointer capture is unavailable, since a captured
  // pointer is treated as staying over its target. Without it a pan released
  // off-canvas would stay latched and the next bare hover would pan.
  const onPointerLeave = () => {
    endGesture();
    pressed = null;
    hooks.onHover(null);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const point = local(event);
    const world = screenToWorld(point, scene.viewport);
    const k = clamp(scene.viewport.k * Math.exp(-event.deltaY * ZOOM_RATE), MIN_ZOOM, MAX_ZOOM);
    // Anchor at the cursor: the world point under it must not move.
    scene.viewport.k = k;
    scene.viewport.x = point.x - world.x * k;
    scene.viewport.y = point.y - world.y * k;
    hooks.draw();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
  };
}
