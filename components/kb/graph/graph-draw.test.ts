import { describe, it, expect } from "vitest";
import {
  worldToScreen,
  screenToWorld,
  nodeRadius,
  pickNode,
  nodeMatches,
  type PositionedNode,
} from "./graph-draw";

const node = (id: string, x: number, y: number, d = 0): PositionedNode =>
  ({ id, t: id.toUpperCase(), g: "a", d, x, y }) as PositionedNode;

describe("viewport transforms", () => {
  it("round-trips a point through world and screen space", () => {
    const viewport = { x: 40, y: -15, k: 2.5 };
    const screen = worldToScreen({ x: 12, y: 7 }, viewport);
    expect(screenToWorld(screen, viewport)).toEqual({ x: 12, y: 7 });
  });

  it("scales and translates, in that order", () => {
    expect(worldToScreen({ x: 10, y: 20 }, { x: 5, y: 6, k: 2 })).toEqual({ x: 25, y: 46 });
  });
});

describe("nodeRadius", () => {
  it("grows with the square root of degree, so a hub is prominent, not a planet", () => {
    expect(nodeRadius(0)).toBeCloseTo(3);
    expect(nodeRadius(4)).toBeCloseTo(6.2);
    // 50x the links is well under 8x the radius.
    expect(nodeRadius(50) / nodeRadius(0)).toBeLessThan(8);
  });
});

describe("pickNode", () => {
  const nodes = [node("a", 0, 0, 0), node("b", 100, 0, 9)];

  it("returns the node under the point", () => {
    expect(pickNode(nodes, { x: 1, y: 1 }, 1)?.id).toBe("a");
  });

  it("returns null when the point is over empty space", () => {
    expect(pickNode(nodes, { x: 50, y: 50 }, 1)).toBeNull();
  });

  it("prefers the nearer node when two overlap", () => {
    const stacked = [node("far", 0, 0, 20), node("near", 6, 0, 20)];
    expect(pickNode(stacked, { x: 7, y: 0 }, 1)?.id).toBe("near");
  });

  it("widens the target in world units as the view zooms out", () => {
    // At k=1 this point misses; zoomed out, the same world gap is a few screen
    // pixels, so the node stays clickable.
    expect(pickNode(nodes, { x: 12, y: 0 }, 1)).toBeNull();
    expect(pickNode(nodes, { x: 12, y: 0 }, 0.2)?.id).toBe("a");
  });
});

describe("nodeMatches", () => {
  const target = node("00-overview/product-vision", 0, 0);

  it("matches on title and on path, case-insensitively", () => {
    expect(nodeMatches(target, "PRODUCT")).toBe(true);
    expect(nodeMatches(target, "00-overview")).toBe(true);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(nodeMatches(target, "")).toBe(true);
    expect(nodeMatches(target, "   ")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(nodeMatches(target, "roadmap")).toBe(false);
  });
});
