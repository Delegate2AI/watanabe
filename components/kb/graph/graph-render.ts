import {
  nodeMatches,
  nodeRadius,
  worldToScreen,
  type PositionedNode,
  type Viewport,
} from "./graph-draw";
import type { GraphPalette } from "./graph-theme";

/**
 * The paint pass, and the mutable bag it paints from.
 *
 * `Scene` is deliberately a plain mutable object held in a ref rather than
 * React state: the pointer handlers and the animation-frame loop write to it
 * sixty times a second, and routing that through `useState` would re-render the
 * tree once per frame to produce the same single `<canvas>` element.
 *
 * Draw order is edges, then nodes, then labels, so a label is never buried
 * under a node that happens to be drawn after it.
 */
export interface Scene {
  nodes: PositionedNode[];
  edges: readonly [number, number][];
  viewport: Viewport;
  /** The node under the pointer, which dims everything not adjacent to it. */
  hover: PositionedNode | null;
  /** The hovered node plus its neighbours. Empty when nothing is hovered. */
  highlight: Set<PositionedNode>;
  palette: GraphPalette;
  /** Group name to hue index. A group with no entry draws neutral. */
  slots: ReadonlyMap<string, number>;
  query: string;
  /** CSS pixels, not device pixels. */
  width: number;
  height: number;
  dpr: number;
}

/** Above this zoom every label is legible enough to be worth the paint. */
const LABEL_ZOOM = 1.4;
/** What a node drops to when a hover excludes it. Fixed by the design spec. */
const DIM_ALPHA = 0.15;
const MIN_SCREEN_RADIUS = 1.5;
const LABEL_GAP_PX = 3;

/** Adjacency by node identity, so a hover can dim everything else in one pass. */
export function buildAdjacency(
  nodes: readonly PositionedNode[],
  edges: readonly [number, number][],
): Map<PositionedNode, Set<PositionedNode>> {
  const adjacency = new Map<PositionedNode, Set<PositionedNode>>();
  for (const node of nodes) adjacency.set(node, new Set());
  for (const [a, b] of edges) {
    const from = nodes[a];
    const to = nodes[b];
    if (!from || !to) continue;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
  }
  return adjacency;
}

function screenRadius(node: PositionedNode, viewport: Viewport): number {
  return Math.max(nodeRadius(node.d) * viewport.k, MIN_SCREEN_RADIUS);
}

function nodeColor(node: PositionedNode, scene: Scene): string {
  const slot = scene.slots.get(node.g);
  if (slot === undefined) return scene.palette.nodeNeutral;
  return scene.palette.groups[slot] ?? scene.palette.nodeNeutral;
}

function labelVisible(node: PositionedNode, scene: Scene): boolean {
  if (scene.viewport.k > LABEL_ZOOM) return true;
  if (scene.hover === node) return true;
  return scene.query.trim() !== "" && nodeMatches(node, scene.query);
}

function isLit(node: PositionedNode, scene: Scene): boolean {
  if (scene.hover !== null && !scene.highlight.has(node)) return false;
  return nodeMatches(node, scene.query);
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { palette, viewport, width, height, dpr } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.edge;
  for (const [a, b] of scene.edges) {
    const from = scene.nodes[a];
    const to = scene.nodes[b];
    if (!from || !to) continue;
    ctx.globalAlpha = isLit(from, scene) && isLit(to, scene) ? 1 : DIM_ALPHA;
    const start = worldToScreen(from, viewport);
    const end = worldToScreen(to, viewport);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  for (const node of scene.nodes) {
    const point = worldToScreen(node, viewport);
    const radius = screenRadius(node, viewport);
    ctx.globalAlpha = isLit(node, scene) ? 1 : DIM_ALPHA;
    ctx.fillStyle = nodeColor(node, scene);
    ctx.beginPath();
    // Shape is the kind channel (spec 2026-08-17-kb-task-links-design §B): a
    // task draws as a square, a note as a circle. Hue stays the group palette
    // for both, so the measured three-hue cap is untouched.
    if (node.k === "task") ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    else ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.label;
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const node of scene.nodes) {
    if (!labelVisible(node, scene)) continue;
    const point = worldToScreen(node, viewport);
    ctx.fillText(node.t, point.x, point.y + screenRadius(node, viewport) + LABEL_GAP_PX);
  }
}
