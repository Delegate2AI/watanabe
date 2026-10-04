import type { GraphNode } from "@/lib/kb/graph";

/**
 * Geometry and predicates for the graph canvas, with no canvas and no React in
 * sight. Hit-testing, the transforms and the size ramp are the parts that can
 * actually be wrong, so they live here where they are testable; the component
 * keeps only the parts that need a rendering context.
 */

/** Pan and zoom, applied as screen = world * k + offset. */
export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A node once `d3-force` has given it coordinates. */
export type PositionedNode = GraphNode & Point;

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return { x: point.x * viewport.k + viewport.x, y: point.y * viewport.k + viewport.y };
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.x) / viewport.k, y: (point.y - viewport.y) / viewport.k };
}

const RADIUS_BASE = 3;
const RADIUS_SCALE = 1.6;

/**
 * Square-rooted so a 50-link hub reads as prominent rather than as a planet.
 * Radius is in world units; the viewport scales it on the way to the screen.
 */
export function nodeRadius(degree: number): number {
  return RADIUS_BASE + RADIUS_SCALE * Math.sqrt(degree);
}

/** Extra world-space slop so a node stays clickable when the view is zoomed out. */
const PICK_SLOP_PX = 4;

/**
 * The node under `world`, or null. A linear scan: 2,000 distance checks per
 * mousemove is a few microseconds, and a quadtree here would be complexity
 * bought with no measurement behind it. If the vault outgrows it, this function
 * is where it changes and the signature does not.
 */
export function pickNode(
  nodes: readonly PositionedNode[],
  world: Point,
  k: number,
): PositionedNode | null {
  let best: PositionedNode | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const dx = node.x - world.x;
    const dy = node.y - world.y;
    const distance = Math.hypot(dx, dy);
    const reach = nodeRadius(node.d) + PICK_SLOP_PX / k;
    if (distance <= reach && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Substring match on title and path. An empty query matches everything. */
export function nodeMatches(node: GraphNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return node.t.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
}
