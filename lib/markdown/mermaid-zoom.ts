/**
 * Viewport maths for the diagram viewer (components/ui/mermaid-viewer.tsx).
 *
 * Pure on purpose. The viewer itself is a thin shell of pointer and wheel
 * handlers over these four functions, so the part that can actually be wrong
 * (zoom that drifts, a clamp that pans anyway) is testable without a browser,
 * the same split as `mermaid-source.ts` against the renderer.
 *
 * The model: the diagram is centred in its box and drawn with
 * `translate(x, y) scale(scale)`. A content point maps to the box as
 * `v = centre + c * scale + t`, so the centre cancels out of every equation
 * below and no measurement of the diagram or the box is ever needed. Points
 * handed to `zoomAt` are therefore relative to the box CENTRE, not its corner.
 */

export interface ZoomState {
  scale: number;
  /** Pan in CSS pixels, applied before the scale. */
  x: number;
  y: number;
}

/** Fit-to-box, unpanned. Also what the reset control returns to. */
export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

/**
 * Bounds. The floor is below 1 so an oversized diagram can be pulled back to
 * something readable in one step; the ceiling is where a label is legible at
 * arm's length without letting a stray trackpad gesture lose the diagram.
 */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;

/** The step for the +/- controls and for a keyboard zoom. */
export const STEP = 1.25;

export function clampScale(scale: number): number {
  // NaN only. An infinity is a real direction and clamps to the bound it is
  // heading for, where NaN would otherwise survive both comparisons below and
  // reach the transform as `scale(NaN)`, which renders nothing at all.
  if (Number.isNaN(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by `factor` while holding `point` still under the cursor.
 *
 * The ratio is recomputed from the CLAMPED scale rather than taken as `factor`.
 * At either bound that makes the ratio exactly 1, so a wheel that keeps
 * spinning past maximum zoom leaves the diagram completely alone instead of
 * sliding it out of the box while the scale refuses to move.
 */
export function zoomAt(state: ZoomState, factor: number, point: { x: number; y: number }): ZoomState {
  const scale = clampScale(state.scale * factor);
  const ratio = scale / state.scale;
  return {
    scale,
    x: point.x - (point.x - state.x) * ratio,
    y: point.y - (point.y - state.y) * ratio,
  };
}

/** Drag. Pan is in screen pixels, so it is independent of the current scale. */
export function panBy(state: ZoomState, dx: number, dy: number): ZoomState {
  return { ...state, x: state.x + dx, y: state.y + dy };
}

/**
 * The scale that shows a whole diagram in the box it is opening into, which is
 * where the viewer starts and what its reset control returns to.
 *
 * A diagram taller than the window is the case that sends someone to the viewer
 * in the first place, so opening at natural size would show them the same
 * clipped top third they already had. Scaling UP is capped well below
 * MAX_SCALE: a three-box flowchart blown up to fill a 27-inch display is not
 * fitted, it is shouted.
 */
export function fitScale(
  box: { width: number; height: number },
  content: { width: number; height: number },
  cap = 2,
): number {
  // A zero anywhere means the diagram has not been laid out yet. Leave it alone
  // rather than dividing into a fit of Infinity.
  if (!box.width || !box.height || !content.width || !content.height) return 1;
  const margin = 0.94;
  const fit = Math.min(box.width / content.width, box.height / content.height) * margin;
  return clampScale(Math.min(cap, fit));
}

/**
 * Wheel delta to a zoom factor.
 *
 * Exponential rather than linear so zooming out then back in returns to where
 * it started, and clamped per event because a mouse wheel reports whole lines
 * (deltaY 100+) where a trackpad reports fractions of one, and without a cap
 * the same gesture would jump several steps on the mouse.
 */
export function wheelFactor(deltaY: number): number {
  const clamped = Math.max(-50, Math.min(50, deltaY));
  return Math.exp(-clamped / 220);
}
