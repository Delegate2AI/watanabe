import { describe, it, expect } from "vitest";
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitScale,
  panBy,
  wheelFactor,
  zoomAt,
} from "./mermaid-zoom";

/** Where the point under the cursor lands after a transform, in box coordinates. */
function project(state: { scale: number; x: number; y: number }, content: { x: number; y: number }) {
  return { x: content.x * state.scale + state.x, y: content.y * state.scale + state.y };
}

describe("clampScale", () => {
  it("holds the bounds", () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it("falls back to 1 rather than propagating a bad number", () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(MAX_SCALE);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const point = { x: 120, y: -40 };
    const before = { scale: 1.5, x: 30, y: 12 };
    // The content point currently sitting under the cursor.
    const content = { x: (point.x - before.x) / before.scale, y: (point.y - before.y) / before.scale };

    const after = zoomAt(before, 1.25, point);

    expect(after.scale).toBeCloseTo(1.875);
    const landed = project(after, content);
    expect(landed.x).toBeCloseTo(point.x);
    expect(landed.y).toBeCloseTo(point.y);
  });

  it("zooms about the centre without panning", () => {
    const after = zoomAt(IDENTITY, 2, { x: 0, y: 0 });
    expect(after).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it("does not pan once the scale is clamped", () => {
    // The case a naive implementation gets wrong: at the ceiling the scale stops
    // but the offset keeps moving, so holding the wheel down slides the diagram
    // out of the box while nothing appears to zoom.
    const atMax = { scale: MAX_SCALE, x: 20, y: -5 };
    expect(zoomAt(atMax, 4, { x: 200, y: 100 })).toEqual(atMax);

    const atMin = { scale: MIN_SCALE, x: 20, y: -5 };
    expect(zoomAt(atMin, 0.1, { x: 200, y: 100 })).toEqual(atMin);
  });

  it("round-trips a zoom in and back out", () => {
    const point = { x: 90, y: 70 };
    const out = zoomAt(zoomAt(IDENTITY, 1.25, point), 1 / 1.25, point);
    expect(out.scale).toBeCloseTo(1);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });
});

describe("panBy", () => {
  it("accumulates in screen pixels and leaves the scale alone", () => {
    expect(panBy({ scale: 3, x: 10, y: 10 }, -4, 6)).toEqual({ scale: 3, x: 6, y: 16 });
  });
});

describe("wheelFactor", () => {
  it("zooms in scrolling up and out scrolling down", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });

  it("caps one event so a mouse wheel does not outrun a trackpad", () => {
    expect(wheelFactor(-5000)).toBe(wheelFactor(-50));
    expect(wheelFactor(-50)).toBeLessThan(1.3);
  });

  it("is symmetric, so a scroll down then up returns to the same scale", () => {
    expect(wheelFactor(40) * wheelFactor(-40)).toBeCloseTo(1);
  });
});

describe("fitScale", () => {
  const box = { width: 1000, height: 800 };

  it("shrinks a diagram taller than the box until all of it shows", () => {
    const scale = fitScale(box, { width: 400, height: 1600 });
    expect(scale).toBeCloseTo(0.47);
    expect(1600 * scale).toBeLessThan(box.height);
  });

  it("constrains on whichever axis binds first", () => {
    // Wide and short: the width decides, and the height has room to spare.
    expect(fitScale(box, { width: 2000, height: 100 })).toBeCloseTo(0.47);
  });

  it("stops at the floor rather than fitting a diagram into illegibility", () => {
    // Nothing is readable at a quarter size, so a diagram this wide opens
    // clipped and is panned, which is the honest outcome.
    expect(fitScale(box, { width: 9000, height: 100 })).toBe(MIN_SCALE);
  });

  it("enlarges a small diagram but not without limit", () => {
    expect(fitScale(box, { width: 400, height: 300 })).toBeCloseTo(2);
    expect(fitScale(box, { width: 10, height: 10 })).toBe(2);
  });

  it("leaves the scale alone when nothing has been laid out yet", () => {
    expect(fitScale(box, { width: 0, height: 0 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1);
  });
});
