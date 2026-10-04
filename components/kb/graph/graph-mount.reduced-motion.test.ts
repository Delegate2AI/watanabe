// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ForceSettings } from "./graph-sim";

/**
 * Exercises `mountGraph` directly rather than through `GraphCanvas`, so the
 * fake `./graph-sim` simulation below is the only thing standing between the
 * test and the real tick count: no React, no `graph-scene.ts` wiring.
 *
 * `window.matchMedia` is reassigned per test, not in the shared
 * `test/setup-dom.ts` stub: that stub only installs itself when
 * `!window.matchMedia`, so a local `beforeEach` override (restored in
 * `afterEach`) is enough to report `prefers-reduced-motion: reduce` as true
 * for exactly these tests.
 */

interface FakeSimulation {
  tickCount: number;
  tick: () => void;
  alpha: () => number;
  alphaMin: () => number;
  stop: () => void;
  force: () => undefined;
}

let lastSimulation: FakeSimulation | null = null;

const createSimulationMock = vi.fn((nodes: unknown, edges: unknown, forces: unknown) => {
  void nodes;
  void edges;
  void forces;
  const sim: FakeSimulation = {
    tickCount: 0,
    tick() {
      this.tickCount++;
    },
    // Always "hot": the reduced-motion loop must be bounded by the tick
    // budget itself, not by alpha decay, or this test would not catch a
    // revert to the unbounded `while (alpha() > alphaMin())` loop.
    alpha: () => 1,
    alphaMin: () => 0.001,
    stop: () => {},
    force: () => undefined,
  };
  lastSimulation = sim;
  return sim;
});

vi.mock("./graph-sim", () => ({
  createSimulation: (nodes: unknown, edges: unknown, forces: unknown) =>
    createSimulationMock(nodes, edges, forces),
  applyForces: () => {},
}));

const { mountGraph } = await import("./graph-mount");

const FORCES: ForceSettings = { center: 0.05, repel: 120, link: 0.3, linkDistance: 40 };

const ctx = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  globalAlpha: 1,
  font: "",
  textAlign: "center",
  textBaseline: "top",
} as unknown as CanvasRenderingContext2D;

function mount() {
  return mountGraph({
    container: document.createElement("div"),
    canvas: document.createElement("canvas"),
    ctx,
    graph: { nodes: [], edges: [], total: 0 },
    dark: false,
    forces: FORCES,
    view: { query: "", slots: new Map() },
    viewport: { x: 0, y: 0, k: 1 },
    centered: { current: false },
    onOpen: () => {},
  });
}

describe("mountGraph under reduced motion", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    createSimulationMock.mockClear();
    lastSimulation = null;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("bounds the mount-time settle to exactly 120 ticks, not a run to alphaMin", () => {
    // Pre-fix behaviour measured 300 ticks at mount; an exact count is what
    // would catch a silent revert to the unbounded loop, not just "it stops".
    const scene = mount();
    expect(lastSimulation?.tickCount).toBe(120);
    scene.destroy();
  });

  it("bounds each setForces settle to exactly 120 more ticks", () => {
    // Pre-fix behaviour measured 248 ticks per drag step, which is what locks
    // a reduced-motion reader's tab for minutes across a slider drag.
    const scene = mount();
    expect(lastSimulation?.tickCount).toBe(120);

    scene.setForces(FORCES);
    expect(lastSimulation?.tickCount).toBe(240);

    scene.destroy();
  });
});
