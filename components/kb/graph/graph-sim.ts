import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from "d3-force";
import { nodeRadius, type PositionedNode } from "./graph-draw";

/**
 * Force setup for the graph canvas. `d3-force` is here for one reason:
 * `forceManyBody` is a Barnes-Hut approximation, and a naive O(n^2) repulsion
 * at 2,000 nodes is roughly four million pair computations per tick.
 *
 * The simulation is created STOPPED. The component ticks it one step per
 * animation frame so the reader watches it settle, which is the behaviour that
 * makes a force slider legible while it is being dragged. A worker would buy a
 * smoother settle nobody sees, at the cost of bundling plumbing.
 */

/** The four sliders, matching Obsidian's names. */
export interface ForceSettings {
  center: number;
  repel: number;
  link: number;
  linkDistance: number;
}

export const DEFAULT_FORCES: ForceSettings = {
  center: 0.05,
  repel: 120,
  link: 0.3,
  linkDistance: 40,
};

interface SimLink {
  source: number | PositionedNode;
  target: number | PositionedNode;
}

export function createSimulation(
  nodes: PositionedNode[],
  edges: readonly [number, number][],
  forces: ForceSettings,
): Simulation<PositionedNode, SimLink> {
  const links: SimLink[] = edges.map(([source, target]) => ({ source, target }));
  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody<PositionedNode>().strength(-forces.repel))
    .force(
      "link",
      forceLink<PositionedNode, SimLink>(links)
        .distance(forces.linkDistance)
        .strength(forces.link),
    )
    .force("center", forceCenter(0, 0).strength(forces.center))
    .force(
      "collide",
      forceCollide<PositionedNode>().radius((node) => nodeRadius(node.d) + 2),
    );
  simulation.stop();
  return simulation;
}

/**
 * Push slider changes into a live simulation and set the alpha that makes the
 * change visible. Sets alpha only: the simulation stays stopped (created
 * stopped, see above), because `graph-mount.ts` owns every tick by hand on
 * the animation frame, or, under reduced motion, by a bounded manual loop. A
 * `restart()`/`stop()` pair here would only start and immediately cancel
 * d3-force's own internal timer, which this component never uses.
 */
export function applyForces(
  simulation: Simulation<PositionedNode, SimLink>,
  forces: ForceSettings,
): void {
  const charge = simulation.force("charge") as ReturnType<typeof forceManyBody> | undefined;
  charge?.strength(-forces.repel);
  const link = simulation.force("link") as ReturnType<typeof forceLink> | undefined;
  link?.distance(forces.linkDistance).strength(forces.link);
  const center = simulation.force("center") as ReturnType<typeof forceCenter> | undefined;
  center?.strength(forces.center);
  simulation.alpha(0.3);
}
